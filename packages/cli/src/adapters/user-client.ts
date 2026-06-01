import fs from "fs";
import yaml from "js-yaml";
import TOML from "@iarna/toml";
import { McpServer } from "../types.js";
import { Adapter, defaultMerge } from "./base.js";
import { resolvePath, safeWrite } from "../utils/fs.js";

/**
 * For YAML files, replace only the rootKey section without reformatting the rest of the file.
 * Finds the "key:" line at column 0, replaces until the next top-level key or EOF.
 */
function patchYamlSection(rawFile: string, rootKey: string, data: unknown): string {
  const newBlock = yaml.dump({ [rootKey]: data }, { indent: 2 }).trimEnd();
  const lines = rawFile.split("\n");

  // Find the start line of the rootKey section (top-level key at column 0)
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === `${rootKey}:` || line.startsWith(`${rootKey}: `)) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    // Key not found: append at the end
    return rawFile.trimEnd() + "\n" + newBlock + "\n";
  }

  // Find the end of the section: next non-blank, non-comment top-level line
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && !line.startsWith("#")) {
      sectionEnd = i;
      break;
    }
  }

  const before = lines.slice(0, sectionStart).join("\n");
  const after = lines.slice(sectionEnd).join("\n");
  const separator = after.length > 0 ? "\n" : "";
  return before + (before.length > 0 ? "\n" : "") + newBlock + "\n" + separator + after;
}

export function createUserClientAdapter(
  adapterName: string,
  configFilePath: string,
  rootKey: string,
  format: "json" | "toml" | "yaml"
): Adapter {
  return {
    name: adapterName,

    configPath(): string {
      return resolvePath(configFilePath);
    },

    read(): Record<string, McpServer> | null {
      const p = this.configPath();
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, "utf-8");
      try {
        let parsed: Record<string, unknown>;
        if (format === "yaml") {
          parsed = (yaml.load(raw) as Record<string, unknown>) ?? {};
        } else if (format === "toml") {
          parsed = TOML.parse(raw) as Record<string, unknown>;
        } else {
          parsed = JSON.parse(raw);
        }
        return (parsed[rootKey] as Record<string, McpServer>) ?? {};
      } catch {
        console.error(`Warning: ${p} is corrupted. Skipping read.`);
        return null;
      }
    },

    write(servers: Record<string, McpServer>): string | null {
      const p = this.configPath();

      if (format === "yaml") {
        const raw = fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
        return safeWrite(p, patchYamlSection(raw, rootKey, servers));
      }

      // JSON / TOML: full roundtrip (these formats don't have the same formatting sensitivity)
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf-8");
        try {
          existing = format === "toml"
            ? TOML.parse(raw) as Record<string, unknown>
            : JSON.parse(raw);
        } catch {
          console.error(`Warning: ${p} is corrupted. Overwriting with new content.`);
        }
      }
      existing[rootKey] = servers;
      const output = format === "toml"
        ? TOML.stringify(existing as Parameters<typeof TOML.stringify>[0])
        : JSON.stringify(existing, null, 2);
      return safeWrite(p, output);
    },

    merge: defaultMerge,
  };
}
