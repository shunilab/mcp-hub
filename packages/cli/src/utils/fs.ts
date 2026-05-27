import fs from "fs";
import path from "path";
import os from "os";

const BACKUP_DIR = path.join(os.homedir(), ".mcp-hub", "backups");
const BACKUP_TTL_DAYS = 7;

export function resolvePath(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  if (process.platform === "win32") {
    return p
      .replace(/%APPDATA%/gi, process.env.APPDATA ?? "")
      .replace(/%USERPROFILE%/gi, os.homedir());
  }
  return p;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function backupPath(filePath: string): string {
  const name = path.basename(filePath);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(BACKUP_DIR, `${name}.${ts}.bak`);
}

export function safeWrite(filePath: string, content: string): string | null {
  ensureDir(path.dirname(filePath));
  ensureDir(BACKUP_DIR);

  let backupFile: string | null = null;
  if (fs.existsSync(filePath)) {
    backupFile = backupPath(filePath);
    fs.copyFileSync(filePath, backupFile);
  }

  fs.writeFileSync(filePath, content, "utf-8");
  return backupFile;
}

export function readFile(filePath: string): string | null {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved, "utf-8");
}

export function getLatestBackup(filePath: string): string | null {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const name = path.basename(filePath);
  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(name + ".") && f.endsWith(".bak"))
    .sort()
    .reverse();
  return backups.length > 0 ? path.join(BACKUP_DIR, backups[0]) : null;
}

export function pruneOldBackups(ttlDays = BACKUP_TTL_DAYS) {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    const full = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
  }
}
