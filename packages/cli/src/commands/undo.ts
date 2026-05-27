import fs from "fs";
import chalk from "chalk";
import { getHubFile } from "../hub.js";
import { getLatestBackup } from "../utils/fs.js";
import { getAdapter } from "../adapters/index.js";

export function undo(options: { client?: string }) {
  const targetFile = options.client
    ? getAdapter(options.client)?.configPath()
    : getHubFile();

  if (!targetFile) {
    console.error(chalk.red(`Unknown client: ${options.client}`));
    process.exit(1);
  }

  const backup = getLatestBackup(targetFile);
  if (!backup) {
    console.log(chalk.yellow("No backup found"));
    return;
  }

  fs.copyFileSync(backup, targetFile);
  console.log(chalk.green(`✓ Restored from backup: ${backup}`));
}
