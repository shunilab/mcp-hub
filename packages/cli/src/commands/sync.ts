import fs from "fs";
import chalk from "chalk";
import { loadHub, loadHubForWrite, saveHub } from "../hub.js";
import { getAllAdapters, getAdapter } from "../adapters/index.js";

export async function sync(options: { from?: string; to?: string; server?: string; create?: boolean; move?: boolean }) {
  const { from, to, server: serverName, create, move } = options;

  if (from && from !== "master" && from !== "all") {
    // client → master or client → client
    const srcAdapter = getAdapter(from);
    if (!srcAdapter) {
      console.error(chalk.red(`Unknown client: ${from}`));
      process.exit(1);
    }
    let srcServers = srcAdapter.read();
    if (!srcServers) {
      console.error(chalk.yellow(`No config found for ${from}`));
      return;
    }
    if (serverName) {
      if (!srcServers[serverName]) {
        console.error(chalk.red(`Server "${serverName}" not found in ${from}`));
        process.exit(1);
      }
      srcServers = { [serverName]: srcServers[serverName] };
    }

    if (!to || to === "master") {
      const hub = loadHubForWrite();
      hub.mcpServers = { ...hub.mcpServers, ...srcServers };
      saveHub(hub);
      console.log(chalk.green(`✓ ${from} → master: ${Object.keys(srcServers).length} server(s) merged`));
    } else {
      const dstAdapter = getAdapter(to);
      if (!dstAdapter) {
        console.error(chalk.red(`Unknown client: ${to}`));
        process.exit(1);
      }
      const existing = dstAdapter.read() ?? {};
      dstAdapter.write(dstAdapter.merge(existing, srcServers));
      console.log(chalk.green(`✓ ${from} → ${to}: ${Object.keys(srcServers).length} server(s) merged`));
    }

    if (move) {
      const remaining = { ...(srcAdapter.read() ?? {}) };
      for (const key of Object.keys(srcServers)) delete remaining[key];
      srcAdapter.write(remaining);
      console.log(chalk.gray(`  (moved: removed from ${from})`));
    }
    return;
  }

  if (from === "all") {
    // all clients → master
    if (move) console.error(chalk.yellow("Warning: --move has no effect with --from all; ignoring."));
    const hub = loadHubForWrite();
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
  let masterServers = hub.mcpServers;
  if (serverName) {
    if (!masterServers[serverName]) {
      console.error(chalk.red(`Server "${serverName}" not found in master`));
      process.exit(1);
    }
    masterServers = { [serverName]: masterServers[serverName] };
  }

  const targets = to ? [getAdapter(to)].filter(Boolean) : getAllAdapters();

  if (to && targets.length === 0) {
    console.error(chalk.red(`Unknown client: ${to}`));
    process.exit(1);
  }

  if (move && !to) {
    console.error(chalk.yellow("Warning: --move requires an explicit --to; ignoring."));
  }

  for (const adapter of targets) {
    if (!adapter) continue;
    if (!to && !create && !fs.existsSync(adapter.configPath())) {
      console.log(chalk.gray(`  ${adapter.name}: skipped (no existing config; use --create to add)`));
      continue;
    }
    const existing = adapter.read() ?? {};
    adapter.write(adapter.merge(existing, masterServers));
    console.log(chalk.green(`✓ master → ${adapter.name}`));
  }

  if (move && to) {
    const hubForWrite = loadHubForWrite();
    for (const key of Object.keys(masterServers)) delete hubForWrite.mcpServers[key];
    saveHub(hubForWrite);
    console.log(chalk.gray("  (moved: removed from master)"));
  }
}
