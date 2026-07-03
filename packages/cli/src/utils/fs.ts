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

// One transaction id per CLI invocation, so every file this process touches
// can be undone together as a single unit (e.g. a bulk sync writing to five
// client config files).
let processTxn: string | null = null;
function getTxnId(): string {
  if (!processTxn) processTxn = `${process.pid}-${Date.now()}`;
  return processTxn;
}

interface BackupSidecar {
  origin: string;
  txn?: string;
  created?: boolean;
}

function writeSidecar(backupFile: string, sidecar: BackupSidecar) {
  fs.writeFileSync(backupFile + ".origin", JSON.stringify(sidecar), "utf-8");
}

function readSidecar(backupFile: string): BackupSidecar | null {
  const sidecarPath = backupFile + ".origin";
  if (!fs.existsSync(sidecarPath)) return null;
  const raw = fs.readFileSync(sidecarPath, "utf-8").trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.origin === "string") return parsed as BackupSidecar;
  } catch {
    // Legacy sidecar: a bare original path with no JSON/txn info.
  }
  return raw ? { origin: raw } : null;
}

export function safeWrite(filePath: string, content: string): string | null {
  ensureDir(path.dirname(filePath));
  ensureDir(BACKUP_DIR);

  const txn = getTxnId();
  const backupFile = backupPath(filePath);

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupFile);
    writeSidecar(backupFile, { origin: filePath, txn, created: false });
  } else {
    // No prior file: record a creation marker (empty backup) so undo can
    // remove this file instead of trying to restore content that never existed.
    fs.writeFileSync(backupFile, "", "utf-8");
    writeSidecar(backupFile, { origin: filePath, txn, created: true });
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

export interface UndoEntry {
  backupFile: string;
  originalFile: string;
  created: boolean;
}

/**
 * Find the most recent backup and every other backup sharing its transaction
 * id, so a multi-file operation (e.g. bulk sync) can be undone as one unit.
 * Legacy backups (pre-transaction sidecars) have no txn and are undone alone.
 */
export function getUndoGroup(): UndoEntry[] | null {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const entries = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".bak"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) return null;

  const latestFile = path.join(BACKUP_DIR, entries[0].f);
  const latestSidecar = readSidecar(latestFile);
  if (!latestSidecar) return null;

  if (!latestSidecar.txn) {
    return [{ backupFile: latestFile, originalFile: latestSidecar.origin, created: !!latestSidecar.created }];
  }

  const group: UndoEntry[] = [];
  for (const { f } of entries) {
    const backupFile = path.join(BACKUP_DIR, f);
    const sidecar = readSidecar(backupFile);
    if (!sidecar || sidecar.txn !== latestSidecar.txn) continue;
    group.push({ backupFile, originalFile: sidecar.origin, created: !!sidecar.created });
  }
  return group;
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
