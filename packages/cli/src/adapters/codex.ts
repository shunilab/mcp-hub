import fs from "fs";
import TOML from "@iarna/toml";
import { McpServer } from "../types.js";
import { Adapter, defaultMerge } from "./base.js";
import { resolvePath, safeWrite } from "../utils/fs.js";

const PATHS = {
  darwin: "~/.codex/config.toml",
  win32: "%USERPROFILE%/.codex/config.toml",
};

export const codexAdapter: Adapter = {
  name: "codex",

  configPath(): string {
    const platform = process.platform as "darwin" | "win32";
    return resolvePath(PATHS[platform] ?? PATHS.darwin);
  },

  read(): Record<string, McpServer> | null {
    const p = this.configPath();
    if (!fs.existsSync(p)) return null;
    let raw: Record<string, unknown>;
    try {
      raw = TOML.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    } catch {
      console.error(`Warning: ${p} is corrupted. Skipping read.`);
      return null;
    }
    const mcp_servers = raw.mcp_servers as Record<string, Record<string, unknown>> | undefined;
    if (!mcp_servers) return {};
    return Object.fromEntries(
      Object.entries(mcp_servers).map(([k, v]) => [
        k,
        {
          command: v.command as string | undefined,
          args: v.args as string[] | undefined,
          env: v.env as Record<string, string> | undefined,
          url: v.url as string | undefined,
        },
      ])
    );
  },

  write(servers: Record<string, McpServer>): string | null {
    const p = this.configPath();
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(p)) {
      try {
        existing = TOML.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
      } catch {
        throw new Error(`${p} is corrupted and cannot be safely updated. Fix or remove it, then retry.`);
      }
    }
    existing.mcp_servers = Object.fromEntries(
      Object.entries(servers).map(([k, v]) => {
        const entry: Record<string, unknown> = {};
        if (v.command) entry.command = v.command;
        if (v.args) entry.args = v.args;
        if (v.env) entry.env = v.env;
        if (v.url) entry.url = v.url;
        return [k, entry];
      })
    );
    return safeWrite(p, TOML.stringify(existing as Parameters<typeof TOML.stringify>[0]));
  },

  merge: defaultMerge,
};
