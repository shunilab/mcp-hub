import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { safeWrite } from "../utils/fs.js";

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
