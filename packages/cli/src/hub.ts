import fs from "fs";
import path from "path";
import os from "os";
import { HubConfig, HubConfigSchema, McpServer } from "./types.js";
import { safeWrite } from "./utils/fs.js";

const HUB_DIR = path.join(os.homedir(), ".mcp-hub");
const HUB_FILE = path.join(HUB_DIR, "servers.json");

const EMPTY_CONFIG: HubConfig = { version: 1, mcpServers: {} };

export function loadHub(): HubConfig {
  if (!fs.existsSync(HUB_FILE)) return { ...EMPTY_CONFIG, mcpServers: {} };
  const raw = JSON.parse(fs.readFileSync(HUB_FILE, "utf-8"));
  return HubConfigSchema.parse(raw);
}

export function saveHub(config: HubConfig): string | null {
  return safeWrite(HUB_FILE, JSON.stringify(config, null, 2));
}

export function addServer(name: string, server: McpServer): void {
  const config = loadHub();
  config.mcpServers[name] = server;
  saveHub(config);
}

export function removeServer(name: string): boolean {
  const config = loadHub();
  if (!(name in config.mcpServers)) return false;
  delete config.mcpServers[name];
  saveHub(config);
  return true;
}

export function getHubFile(): string {
  return HUB_FILE;
}

export function getHubDir(): string {
  return HUB_DIR;
}
