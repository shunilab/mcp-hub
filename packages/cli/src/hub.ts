import fs from "fs";
import path from "path";
import os from "os";
import { HubConfig, HubConfigSchema, McpServer } from "./types.js";
import { safeWrite } from "./utils/fs.js";

const HUB_DIR = path.join(os.homedir(), ".mcp-hub");
const HUB_FILE = path.join(HUB_DIR, "servers.json");

const EMPTY_CONFIG: HubConfig = { version: 1, mcpServers: {} };

function readRawHub(): unknown | undefined {
  if (!fs.existsSync(HUB_FILE)) return undefined;
  return JSON.parse(fs.readFileSync(HUB_FILE, "utf-8"));
}

/**
 * Tolerant read for display-only commands (status, list): a corrupted or
 * schema-mismatched hub file degrades to an empty config rather than
 * crashing, since these commands never write the result back.
 */
export function loadHub(): HubConfig {
  let raw: unknown;
  try {
    raw = readRawHub();
  } catch {
    console.error(`Warning: ${HUB_FILE} is corrupted (invalid JSON). Reading as empty config.`);
    return { ...EMPTY_CONFIG, mcpServers: {} };
  }
  if (raw === undefined) return { ...EMPTY_CONFIG, mcpServers: {} };
  try {
    return HubConfigSchema.parse(raw);
  } catch {
    console.error(`Warning: ${HUB_FILE} does not match the expected schema. Reading as empty config.`);
    return { ...EMPTY_CONFIG, mcpServers: {} };
  }
}

/**
 * Strict read for any command that will mutate and save the hub file. A
 * corrupted or schema-mismatched hub file throws instead of silently
 * degrading — saving an "empty" config over it would destroy the user's
 * data (see the original data-loss bug this replaces).
 */
export function loadHubForWrite(): HubConfig {
  let raw: unknown;
  try {
    raw = readRawHub();
  } catch {
    throw new Error(`${HUB_FILE} is corrupted (invalid JSON) and cannot be safely updated. Fix or remove it, then retry.`);
  }
  if (raw === undefined) return { ...EMPTY_CONFIG, mcpServers: {} };
  try {
    return HubConfigSchema.parse(raw);
  } catch {
    throw new Error(`${HUB_FILE} does not match the expected schema and cannot be safely updated. Fix or remove it, then retry.`);
  }
}

export function saveHub(config: HubConfig): string | null {
  return safeWrite(HUB_FILE, JSON.stringify(config, null, 2));
}

export function addServer(name: string, server: McpServer, options: { force?: boolean } = {}): void {
  const config = loadHubForWrite();
  if (!options.force && name in config.mcpServers) {
    throw new Error(`Server "${name}" already exists in master. Use --force to overwrite.`);
  }
  config.mcpServers[name] = server;
  saveHub(config);
}

export function removeServer(name: string): boolean {
  const config = loadHubForWrite();
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
