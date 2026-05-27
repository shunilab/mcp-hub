import chalk from "chalk";
import { loadHub } from "../hub.js";
import { getAdapter } from "../adapters/index.js";

export function list(options: { client?: string; json?: boolean }) {
  if (options.client && options.client !== "master") {
    const adapter = getAdapter(options.client);
    if (!adapter) {
      console.error(chalk.red(`Unknown client: ${options.client}`));
      process.exit(1);
    }
    const servers = adapter.read();
    if (!servers) {
      if (options.json) { console.log(JSON.stringify({})); return; }
      console.log(chalk.yellow(`No config found for ${options.client}`));
      return;
    }
    if (options.json) { console.log(JSON.stringify(servers)); return; }
    console.log(chalk.bold(`\n${options.client}:`));
    for (const [name, s] of Object.entries(servers)) {
      const desc = s.command ? `${s.command} ${(s.args ?? []).join(" ")}` : s.url ?? "";
      console.log(`  ${chalk.cyan(name)}: ${desc}`);
    }
    return;
  }

  const hub = loadHub();
  const servers = hub.mcpServers;
  if (options.json) { console.log(JSON.stringify(servers)); return; }
  console.log(chalk.bold(`\nMaster (${Object.keys(servers).length} servers):`));
  for (const [name, s] of Object.entries(servers)) {
    const desc = s.command ? `${s.command} ${(s.args ?? []).join(" ")}` : s.url ?? "";
    console.log(`  ${chalk.cyan(name)}: ${desc}`);
  }
}
