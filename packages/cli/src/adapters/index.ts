import path from "path";
import os from "os";
import fs from "fs";
import { Adapter } from "./base.js";
import { createJsonMcpServersAdapter } from "./json-mcpservers.js";
import { opencodeAdapter } from "./opencode.js";
import { codexAdapter } from "./codex.js";
import { UserClients, UserClientsSchema } from "../types.js";
import { resolvePath } from "../utils/fs.js";

const CLIENTS_FILE = path.join(os.homedir(), ".mcp-hub", "clients.json");

const BUILT_IN_ADAPTERS: Adapter[] = [
  createJsonMcpServersAdapter("claude-desktop", {
    darwin: "~/Library/Application Support/Claude/claude_desktop_config.json",
    win32: "%APPDATA%\\Claude\\claude_desktop_config.json",
  }),
  createJsonMcpServersAdapter("claude-code", {
    darwin: "~/.claude.json",
    win32: "%USERPROFILE%\\.claude.json",
  }),
  createJsonMcpServersAdapter("cline", {
    darwin: "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    win32: "%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json",
  }),
  createJsonMcpServersAdapter("roo-code", {
    darwin: "~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json",
    win32: "%APPDATA%\\Code\\User\\globalStorage\\rooveterinaryinc.roo-cline\\settings\\mcp_settings.json",
  }),
  opencodeAdapter,
  codexAdapter,
];

function loadUserAdapters(): Adapter[] {
  if (!fs.existsSync(CLIENTS_FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf-8"));
  const userClients = UserClientsSchema.parse(raw);
  return Object.entries(userClients).map(([name, cfg]) => {
    const platform = process.platform as "darwin" | "win32";
    const rawPath = typeof cfg.configPath === "string"
      ? cfg.configPath
      : cfg.configPath[platform] ?? (cfg.configPath as Record<string, string>).darwin;

    return createJsonMcpServersAdapter(name, {
      darwin: rawPath,
      win32: rawPath,
    });
  });
}

export function getAllAdapters(): Adapter[] {
  return [...BUILT_IN_ADAPTERS, ...loadUserAdapters()];
}

export function getAdapter(name: string): Adapter | undefined {
  return getAllAdapters().find((a) => a.name === name);
}

export { BUILT_IN_ADAPTERS };
