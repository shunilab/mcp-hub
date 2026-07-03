import fs from "fs";
import chalk from "chalk";
import { getUndoGroup } from "../utils/fs.js";

export interface UndoResult {
  restored: string[];
}

export function undo(options: { json?: boolean } = {}) {
  const group = getUndoGroup();
  if (!group || group.length === 0) {
    if (options.json) { console.log(JSON.stringify({ restored: [] } satisfies UndoResult)); return; }
    console.log(chalk.yellow("No backup found"));
    return;
  }

  const restored: string[] = [];
  for (const { backupFile, originalFile, created } of group) {
    if (created) {
      if (fs.existsSync(originalFile)) fs.unlinkSync(originalFile);
    } else {
      fs.copyFileSync(backupFile, originalFile);
    }
    restored.push(originalFile);
    // remove the backup and its sidecar so the next undo goes one step further back
    fs.unlinkSync(backupFile);
    const sidecar = backupFile + ".origin";
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  if (options.json) { console.log(JSON.stringify({ restored } satisfies UndoResult)); return; }
  console.log(chalk.green(`✓ Restored ${restored.length} file(s):`));
  for (const f of restored) console.log(chalk.green(`  - ${f}`));
}
