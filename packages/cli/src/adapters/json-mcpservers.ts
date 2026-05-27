import fs from "fs";
import os from "os";
import { McpServer } from "../types.js";
import { Adapter, defaultMerge } from "./base.js";
import { resolvePath, safeWrite } from "../utils/fs.js";

export function createJsonMcpServersAdapter(
  adapterName: string,
  paths: { darwin: string; win32: string; linux?: string }
): Adapter {
  return {
    name: adapterName,

    configPath(): string {
      const platform = process.platform as "darwin" | "win32" | "linux";
      const p = paths[platform] ?? paths.darwin;
      return resolvePath(p);
    },

    read(): Record<string, McpServer> | null {
      const p = this.configPath();
      if (!fs.existsSync(p)) return null;
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        console.error(`Warning: ${p} is corrupted. Skipping read.`);
        return null;
      }
      return (raw.mcpServers as Record<string, McpServer>) ?? {};
    },

    write(servers: Record<string, McpServer>): string | null {
      const p = this.configPath();
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(p)) {
        try {
          existing = JSON.parse(fs.readFileSync(p, "utf-8"));
        } catch {
          console.error(`Warning: ${p} is corrupted. Overwriting with new content.`);
        }
      }
      existing.mcpServers = servers;
      return safeWrite(p, JSON.stringify(existing, null, 2));
    },

    merge: defaultMerge,
  };
}
