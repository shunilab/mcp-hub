import fs from "fs";
import chalk from "chalk";
import { getGlobalLatestBackup } from "../utils/fs.js";

export function undo() {
  const result = getGlobalLatestBackup();
  if (!result) {
    console.log(chalk.yellow("No backup found"));
    return;
  }

  const { backupFile, originalFile } = result;
  fs.copyFileSync(backupFile, originalFile);
  // remove the backup and its sidecar so the next undo goes one step further back
  fs.unlinkSync(backupFile);
  const sidecar = backupFile + ".origin";
  if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);

  console.log(chalk.green(`✓ Restored: ${originalFile}`));
}
