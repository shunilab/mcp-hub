import fs from "fs";
import path from "path";
import os from "os";
import { safeWrite } from "./utils/fs.js";

const SETTINGS_FILE = path.join(os.homedir(), ".mcp-hub", "settings.json");
const DEFAULT_BACKUP_TTL_DAYS = 7;

export interface HubSettings {
  backupTtlDays: number;
}

export function loadSettings(): HubSettings {
  if (!fs.existsSync(SETTINGS_FILE)) return { backupTtlDays: DEFAULT_BACKUP_TTL_DAYS };
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    const days = Number(raw.backupTtlDays);
    return { backupTtlDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_BACKUP_TTL_DAYS };
  } catch {
    return { backupTtlDays: DEFAULT_BACKUP_TTL_DAYS };
  }
}

export function getBackupTtlDays(): number {
  return loadSettings().backupTtlDays;
}

export function setBackupTtlDays(days: number): void {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("backup-ttl must be a positive number of days");
  }
  const settings = loadSettings();
  settings.backupTtlDays = days;
  safeWrite(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
