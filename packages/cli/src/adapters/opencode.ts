import fs from "fs";
import { McpServer } from "../types.js";
import { Adapter, defaultMerge } from "./base.js";
import { resolvePath, safeWrite } from "../utils/fs.js";

const PATHS = {
  darwin: "~/.config/opencode/opencode.json",
  win32: "%APPDATA%/opencode/opencode.json",
};

type OpenCodeServer = {
  type: "local" | "remote";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
};

function toOpenCode(server: McpServer, existingEnabled?: boolean): OpenCodeServer {
  const enabled = existingEnabled ?? true;
  if (server.url) {
    return { type: "remote", url: server.url, headers: server.headers, enabled };
  }
  return {
    type: "local",
    command: server.command,
    args: server.args,
    env: server.env,
    enabled,
  };
}

function fromOpenCode(s: OpenCodeServer): McpServer {
  if (s.type === "remote") return { url: s.url, headers: s.headers };
  return { command: s.command, args: s.args, env: s.env };
}

export const opencodeAdapter: Adapter = {
  name: "opencode",

  configPath(): string {
    const platform = process.platform as "darwin" | "win32";
    return resolvePath(PATHS[platform] ?? PATHS.darwin);
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
    const mcp = raw.mcp as Record<string, OpenCodeServer> | undefined;
    if (!mcp) return {};
    return Object.fromEntries(Object.entries(mcp).map(([k, v]) => [k, fromOpenCode(v)]));
  },

  write(servers: Record<string, McpServer>): string | null {
    const p = this.configPath();
    let existing: Record<string, unknown> = { $schema: "https://opencode.ai/config.json" };
    if (fs.existsSync(p)) {
      try {
        existing = JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        throw new Error(`${p} is corrupted and cannot be safely updated. Fix or remove it, then retry.`);
      }
    }
    const existingMcp = (existing.mcp as Record<string, OpenCodeServer> | undefined) ?? {};
    existing.mcp = Object.fromEntries(
      Object.entries(servers).map(([k, v]) => [k, toOpenCode(v, existingMcp[k]?.enabled)])
    );
    return safeWrite(p, JSON.stringify(existing, null, 2));
  },

  merge: defaultMerge,
};
