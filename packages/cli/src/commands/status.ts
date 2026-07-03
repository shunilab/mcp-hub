import chalk from "chalk";
import { loadHub, getHubFile } from "../hub.js";
import { getAllAdapters, getBaseAdapters } from "../adapters/index.js";
import { McpServer } from "../types.js";
import { getBackupTtlDays } from "../settings.js";

export interface ClientStatus {
  name: string;
  configPath: string;
  defaultConfigPath: string;
  overridden: boolean;
  servers: Record<string, McpServer>;
  configExists: boolean;
  shared: string[];
  masterOnly: string[];
  clientOnly: string[];
}

export interface StatusResult {
  master: Record<string, McpServer>;
  masterConfigPath: string;
  clients: ClientStatus[];
  settings: {
    backupTtlDays: number;
  };
}

export function status(options: { json?: boolean } = {}) {
  const hub = loadHub();
  const masterKeys = new Set(Object.keys(hub.mcpServers));
  const defaultPaths = new Map(getBaseAdapters().map((a) => [a.name, a.configPath()]));
  const result: StatusResult = {
    master: hub.mcpServers,
    masterConfigPath: getHubFile(),
    clients: [],
    settings: { backupTtlDays: getBackupTtlDays() },
  };

  for (const adapter of getAllAdapters()) {
    const configPath = adapter.configPath();
    const defaultConfigPath = defaultPaths.get(adapter.name) ?? configPath;
    const overridden = configPath !== defaultConfigPath;
    const servers = adapter.read();
    if (!servers) {
      result.clients.push({ name: adapter.name, configPath, defaultConfigPath, overridden, servers: {}, configExists: false, shared: [], masterOnly: [...masterKeys], clientOnly: [] });
      if (!options.json) console.log(`  ${chalk.gray(adapter.name)}: ${chalk.yellow("no config file")}`);
      continue;
    }

    const clientKeys = new Set(Object.keys(servers));
    const shared = [...clientKeys].filter((k) => masterKeys.has(k));
    const masterOnly = [...masterKeys].filter((k) => !clientKeys.has(k));
    const clientOnly = [...clientKeys].filter((k) => !masterKeys.has(k));

    result.clients.push({ name: adapter.name, configPath, defaultConfigPath, overridden, servers, configExists: true, shared, masterOnly, clientOnly });

    if (!options.json) {
      console.log(`\n  ${chalk.bold(adapter.name)}: ${clientKeys.size} servers`);
      if (shared.length) console.log(`    ${chalk.green("shared:")} ${shared.join(", ")}`);
      if (masterOnly.length) console.log(`    ${chalk.yellow("master only:")} ${masterOnly.join(", ")}`);
      if (clientOnly.length) console.log(`    ${chalk.cyan("client only:")} ${clientOnly.join(", ")}`);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(chalk.bold(`\nMaster: ${masterKeys.size} servers`));
  }
}
