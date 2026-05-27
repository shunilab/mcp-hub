import chalk from "chalk";
import { removeServer } from "../hub.js";
import { getAdapter } from "../adapters/index.js";

export function remove(name: string, options: { from?: string }) {
  const { from } = options;

  if (from && from !== "master") {
    const adapter = getAdapter(from);
    if (!adapter) {
      console.error(chalk.red(`Unknown client: ${from}`));
      process.exit(1);
    }
    const servers = adapter.read();
    if (!servers || !servers[name]) {
      console.error(chalk.yellow(`"${name}" not found in ${from}`));
      return;
    }
    const updated = { ...servers };
    delete updated[name];
    adapter.write(updated);
    console.log(chalk.green(`✓ Removed "${name}" from ${from}`));
    return;
  }

  const ok = removeServer(name);
  if (ok) {
    console.log(chalk.green(`✓ Removed "${name}" from master`));
  } else {
    console.error(chalk.yellow(`"${name}" not found in master`));
  }
}
