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
    server.env = Object.fromEntries(
      options.env.split(",").map((pair) => pair.split("=") as [string, string])
    );
  }

  addServer(name, server);
  console.log(chalk.green(`✓ Added "${name}" to master`));
}
