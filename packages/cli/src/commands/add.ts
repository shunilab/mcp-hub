import chalk from "chalk";
import { addServer } from "../hub.js";
import { McpServer } from "../types.js";

export function add(name: string, options: { command?: string; args?: string; url?: string; env?: string }) {
  if (!options.command && !options.url) {
    console.error(chalk.red("Either --command or --url is required"));
    process.exit(1);
  }

  const server: McpServer = {};
  if (options.command) {
    server.command = options.command;
    server.args = options.args ? options.args.split(" ") : [];
  }
  if (options.url) server.url = options.url;
  if (options.env) {
    const entries: [string, string][] = [];
    for (const pair of options.env.split(",")) {
      const idx = pair.indexOf("=");
      if (idx < 1) {
        console.error(chalk.yellow(`Warning: Skipping invalid env pair "${pair}" (expected KEY=VALUE)`));
        continue;
      }
      entries.push([pair.slice(0, idx), pair.slice(idx + 1)]);
    }
    server.env = Object.fromEntries(entries);
  }

  addServer(name, server);
  console.log(chalk.green(`✓ Added "${name}" to master`));
}
