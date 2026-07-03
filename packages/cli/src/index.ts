#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { sync } from "./commands/sync.js";
import { add } from "./commands/add.js";
import { remove } from "./commands/remove.js";
import { reorder } from "./commands/reorder.js";
import { list } from "./commands/list.js";
import { importFrom } from "./commands/import.js";
import { status } from "./commands/status.js";
import { undo } from "./commands/undo.js";
import { configSetPath, configUnsetPath, configSetBackupTtl } from "./commands/config.js";
import { clientAdd, clientRemove, clientList } from "./commands/clients.js";
import { pruneOldBackups } from "./utils/fs.js";
import { getBackupTtlDays } from "./settings.js";

pruneOldBackups(getBackupTtlDays());

const program = new Command();

program.name("mcp-hub").description("MCP configuration hub").version("0.1.0");

program
  .command("sync")
  .description("Sync MCP servers between master and clients")
  .option("--from <client>", "Source: client name, 'master', or 'all'")
  .option("--to <client>", "Destination: client name or 'master'")
  .option("--server <name>", "Copy only this specific server")
  .option("--create", "Also create config files for clients that don't have one yet (bulk sync only)")
  .option("--move", "Remove the server from the source after a successful copy (requires an explicit source and destination)")
  .action(sync);

program
  .command("add <name>")
  .description("Add a server to master")
  .option("--command <cmd>", "Command to run the server")
  .option("--args <args>", "Arguments (space-separated, quote the whole string)")
  .option("--url <url>", "URL for remote servers")
  .option("--env <pairs>", "Env vars as KEY=VAL,KEY2=VAL2")
  .option("--json <spec>", "Full server spec as a JSON string (overrides other options)")
  .option("--force", "Overwrite an existing server with the same name")
  .action(add);

program
  .command("remove <name>")
  .description("Remove a server from master or a client")
  .option("--from <client>", "Remove from this client instead of master")
  .action(remove);

program
  .command("list")
  .description("List servers in master or a specific client")
  .option("--client <client>", "Show servers for this client instead of master")
  .option("--json", "Output as JSON")
  .action(list);

program
  .command("import")
  .description("Import servers from a client into master")
  .requiredOption("--from <client>", "Source client")
  .action(importFrom);

program
  .command("status")
  .description("Show sync status across all clients")
  .option("--json", "Output as JSON")
  .action(status);

program
  .command("reorder <client>")
  .description("Reorder servers in master or a client")
  .requiredOption("--order <names>", "Comma-separated server names in desired order")
  .action(reorder);

program
  .command("undo")
  .description("Restore the most recently modified file(s) from backup")
  .option("--json", "Output as JSON")
  .action(undo);

const configCmd = program
  .command("config")
  .description("Manage MCPHub configuration");

configCmd
  .command("set-path <client> <path>")
  .description("Override the config file path for a client")
  .action(configSetPath);

configCmd
  .command("unset-path <client>")
  .description("Reset a client's config file path to its default")
  .action(configUnsetPath);

configCmd
  .command("set-backup-ttl <days>")
  .description("Set how many days to keep backups before pruning")
  .action(configSetBackupTtl);

const clientCmd = program
  .command("client")
  .description("Manage user-defined clients");

clientCmd
  .command("add <id>")
  .description("Add or update a user-defined client")
  .requiredOption("--config-path <path>", "Config file path")
  .option("--root-key <key>", "Root key in config file", "mcpServers")
  .option("--format <fmt>", "File format: json|toml|yaml", "json")
  .action(clientAdd);

clientCmd
  .command("remove <id>")
  .description("Remove a user-defined client")
  .action(clientRemove);

clientCmd
  .command("list")
  .description("List user-defined clients")
  .option("--json", "Output as JSON")
  .action(clientList);

(async () => {
  try {
    await program.parseAsync();
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
})();
