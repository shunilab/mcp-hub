import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { safeWrite } from "../utils/fs.js";
import { setBackupTtlDays } from "../settings.js";

const OVERRIDES_FILE = path.join(os.homedir(), ".mcp-hub", "path-overrides.json");

export function loadOverrides(): Record<string, string> {
  if (!fs.existsSync(OVERRIDES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function configSetPath(client: string, newPath: string) {
  const overrides = loadOverrides();
  overrides[client] = newPath;
  safeWrite(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
  console.log(chalk.green(`✓ ${client} path set to ${newPath}`));
}

export function configUnsetPath(client: string) {
  const overrides = loadOverrides();
  if (!(client in overrides)) {
    console.log(chalk.yellow(`${client} has no path override`));
    return;
  }
  delete overrides[client];
  safeWrite(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
  console.log(chalk.green(`✓ ${client} path reset to default`));
}

export function configSetBackupTtl(daysStr: string) {
  const days = Number(daysStr);
  if (!Number.isFinite(days) || days < 1) {
    console.error(chalk.red("backup-ttl must be a positive number of days"));
    process.exit(1);
    return;
  }
  setBackupTtlDays(days);
  console.log(chalk.green(`✓ Backup retention set to ${days} day(s)`));
}
