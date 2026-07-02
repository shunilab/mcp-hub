import fs from "fs";
import path from "path";
import os from "os";

const BACKUP_DIR = path.join(os.homedir(), ".mcp-hub", "backups");
const BACKUP_TTL_DAYS = 7;

export function resolvePath(p: string): string {
  let resolved = p;
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  if (process.platform === "win32") {
    resolved = resolved
      .replace(/%APPDATA%/gi, process.env.APPDATA ?? "")
      .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? "")
      .replace(/%USERPROFILE%/gi, os.homedir());
    // Normalize separators so the UI shows consistent backslashes on Windows.
    return path.win32.normalize(resolved.replace(/\//g, "\\"));
  }
  return resolved;
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
    // sidecar records the original absolute path for global undo
    fs.writeFileSync(backupFile + ".origin", filePath, "utf-8");
  }

  // Write to a temp file in the same directory, then rename — avoids leaving
  // a half-written file if the process is interrupted mid-write, and avoids
  // racing a concurrent reader of the target path (e.g. another app polling
  // its own config file).
  const tmpFile = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`
  );
  fs.writeFileSync(tmpFile, content, "utf-8");
  fs.renameSync(tmpFile, filePath);
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

/** Find the globally most recent backup and return { backupFile, originalFile }. */
export function getGlobalLatestBackup(): { backupFile: string; originalFile: string } | null {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const entries = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".bak"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) return null;

  const backupFile = path.join(BACKUP_DIR, entries[0].f);
  // filename pattern: <original-basename>.<ISO-timestamp>.bak
  // strip trailing .bak and the timestamp segment (starts with a digit after last '.')
  const withoutBak = entries[0].f.slice(0, -4); // remove ".bak"
  const lastDot = withoutBak.lastIndexOf(".");
  const originalName = lastDot >= 0 ? withoutBak.slice(0, lastDot) : withoutBak;

  // Locate the original file by scanning common parent dirs stored in backup metadata
  // We embed the full original path inside the backup name as a stat of the backup itself.
  // Fallback: read the first line of the backup to determine nothing — instead we store
  // original path in a sidecar entry alongside the backup file.
  const sidecar = backupFile + ".origin";
  if (fs.existsSync(sidecar)) {
    const originalFile = fs.readFileSync(sidecar, "utf-8").trim();
    return { backupFile, originalFile };
  }

  // Legacy: no sidecar — can't determine original path, return null
  void originalName;
  return null;
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
