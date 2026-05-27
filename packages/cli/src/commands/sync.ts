import chalk from "chalk";
import { loadHub, saveHub } from "../hub.js";
import { getAllAdapters, getAdapter } from "../adapters/index.js";

export async function sync(options: { from?: string; to?: string }) {
  const { from, to } = options;

  if (from && from !== "master" && from !== "all") {
    // client → master or client → client
    const srcAdapter = getAdapter(from);
    if (!srcAdapter) {
      console.error(chalk.red(`Unknown client: ${from}`));
      process.exit(1);
    }
    const srcServers = srcAdapter.read();
    if (!srcServers) {
      console.error(chalk.yellow(`No config found for ${from}`));
      return;
    }

    if (!to || to === "master") {
      const hub = loadHub();
      hub.mcpServers = { ...hub.mcpServers, ...srcServers };
      saveHub(hub);
      console.log(chalk.green(`✓ ${from} → master: ${Object.keys(srcServers).length} servers merged`));
    } else {
      const dstAdapter = getAdapter(to);
      if (!dstAdapter) {
        console.error(chalk.red(`Unknown client: ${to}`));
        process.exit(1);
      }
      const existing = dstAdapter.read() ?? {};
      dstAdapter.write(dstAdapter.merge(existing, srcServers));
      console.log(chalk.green(`✓ ${from} → ${to}: ${Object.keys(srcServers).length} servers merged`));
    }
    return;
  }

  if (from === "all") {
    // all clients → master
    const hub = loadHub();
    let total = 0;
    for (const adapter of getAllAdapters()) {
      const servers = adapter.read();
      if (!servers) continue;
      hub.mcpServers = { ...hub.mcpServers, ...servers };
      total += Object.keys(servers).length;
      console.log(chalk.gray(`  ${adapter.name}: ${Object.keys(servers).length} servers`));
    }
    saveHub(hub);
    console.log(chalk.green(`✓ All clients → master: ${total} servers merged`));
    return;
  }

  // master → clients (default)
  const hub = loadHub();
  const targets = to ? [getAdapter(to)].filter(Boolean) : getAllAdapters();

  if (to && targets.length === 0) {
    console.error(chalk.red(`Unknown client: ${to}`));
    process.exit(1);
  }

  for (const adapter of targets) {
    if (!adapter) continue;
    const existing = adapter.read() ?? {};
    adapter.write(adapter.merge(existing, hub.mcpServers));
    console.log(chalk.green(`✓ master → ${adapter.name}`));
  }
}
