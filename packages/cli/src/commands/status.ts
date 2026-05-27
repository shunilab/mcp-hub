import chalk from "chalk";
import { loadHub } from "../hub.js";
import { getAllAdapters } from "../adapters/index.js";

export interface ClientStatus {
  name: string;
  configPath: string;
  servers: Record<string, unknown>;
  configExists: boolean;
  shared: string[];
  masterOnly: string[];
  clientOnly: string[];
}

export function status(options: { json?: boolean } = {}) {
  const hub = loadHub();
  const masterKeys = new Set(Object.keys(hub.mcpServers));
  const result: { master: Record<string, unknown>; clients: ClientStatus[] } = {
    master: hub.mcpServers,
    clients: [],
  };

  for (const adapter of getAllAdapters()) {
    const servers = adapter.read();
    if (!servers) {
      result.clients.push({ name: adapter.name, configPath: adapter.configPath(), servers: {}, configExists: false, shared: [], masterOnly: [...masterKeys], clientOnly: [] });
      if (!options.json) console.log(`  ${chalk.gray(adapter.name)}: ${chalk.yellow("no config file")}`);
      continue;
    }

    const clientKeys = new Set(Object.keys(servers));
    const shared = [...clientKeys].filter((k) => masterKeys.has(k));
    const masterOnly = [...masterKeys].filter((k) => !clientKeys.has(k));
    const clientOnly = [...clientKeys].filter((k) => !masterKeys.has(k));

    result.clients.push({ name: adapter.name, configPath: adapter.configPath(), servers, configExists: true, shared, masterOnly, clientOnly });

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
