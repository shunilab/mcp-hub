import chalk from "chalk";
import { addServer } from "../hub.js";
import { McpServer, McpServerSchema } from "../types.js";

export function add(name: string, options: { command?: string; args?: string; url?: string; env?: string; json?: string }) {
  let server: McpServer;

  if (options.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.json);
    } catch {
      console.error(chalk.red("--json must be valid JSON"));
      process.exit(1);
      return;
    }
    const result = McpServerSchema.safeParse(parsed);
    if (!result.success) {
      console.error(chalk.red(`--json does not match the server schema: ${result.error.message}`));
      process.exit(1);
      return;
    }
    server = result.data;
  } else {
    if (!options.command && !options.url) {
      console.error(chalk.red("Either --command, --url, or --json is required"));
      process.exit(1);
      return;
    }

    server = {};
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
  }

  addServer(name, server);
  console.log(chalk.green(`✓ Added "${name}" to master`));
}
