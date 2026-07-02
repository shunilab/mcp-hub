import chalk from "chalk";
import { loadHubForWrite, saveHub } from "../hub.js";
import { getAdapter } from "../adapters/index.js";

export function importFrom(options: { from: string }) {
  const adapter = getAdapter(options.from);
  if (!adapter) {
    console.error(chalk.red(`Unknown client: ${options.from}`));
    process.exit(1);
  }

  const servers = adapter.read();
  if (!servers) {
    console.log(chalk.yellow(`No config found for ${options.from}`));
    return;
  }

  const hub = loadHubForWrite();
  const before = Object.keys(hub.mcpServers).length;
  hub.mcpServers = { ...hub.mcpServers, ...servers };
  const added = Object.keys(hub.mcpServers).length - before;
  saveHub(hub);

  console.log(chalk.green(`✓ Imported from ${options.from}: ${added} new servers added to master`));
}
