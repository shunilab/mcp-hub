import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { safeWrite } from "../utils/fs.js";
import { UserClients, UserClientsSchema, ClientConfig } from "../types.js";

const CLIENTS_FILE = path.join(os.homedir(), ".mcp-hub", "clients.json");

function loadClients(): UserClients {
  if (!fs.existsSync(CLIENTS_FILE)) return {};
  try {
    return UserClientsSchema.parse(JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf-8")));
  } catch {
    return {};
  }
}

export function clientAdd(
  id: string,
  opts: { configPath: string; rootKey: string; format: string }
) {
  const clients = loadClients();
  const config: ClientConfig = {
    configPath: opts.configPath,
    rootKey: opts.rootKey,
    format: opts.format as "json" | "toml" | "yaml",
  };
  clients[id] = config;
  safeWrite(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  console.log(chalk.green(`✓ Client "${id}" added`));
}

export function clientRemove(id: string) {
  const clients = loadClients();
  if (!(id in clients)) {
    console.error(chalk.red(`Error: Client "${id}" not found`));
    process.exit(1);
  }
  delete clients[id];
  safeWrite(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  console.log(chalk.green(`✓ Client "${id}" removed`));
}

export function clientList(opts: { json?: boolean }) {
  const clients = loadClients();
  if (opts.json) {
    console.log(JSON.stringify(clients));
  } else {
    if (Object.keys(clients).length === 0) {
      console.log("No custom clients defined.");
    } else {
      for (const [id, cfg] of Object.entries(clients)) {
        const p = typeof cfg.configPath === "string" ? cfg.configPath : JSON.stringify(cfg.configPath);
        console.log(`  ${id}  ${p}  (${cfg.format}, key: ${cfg.rootKey})`);
      }
    }
  }
}
