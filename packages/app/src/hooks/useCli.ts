import { invoke } from "@tauri-apps/api/core";
import type { McpServer, ClientStatus, StatusResult, UndoResult } from "@mcp-hub/cli";

export type { McpServer, ClientStatus, StatusResult, UndoResult };

export async function runCli(args: string[]): Promise<string> {
  return invoke<string>("run_cli", { args });
}

export async function fetchStatus(): Promise<StatusResult> {
  const raw = await runCli(["status", "--json"]);
  return JSON.parse(raw);
}

export async function syncFromTo(from?: string, to?: string, server?: string, move?: boolean): Promise<void> {
  const args = ["sync"];
  if (from) args.push("--from", from);
  if (to) args.push("--to", to);
  if (server) args.push("--server", server);
  if (move) args.push("--move");
  await runCli(args);
}

export async function importFrom(client: string): Promise<void> {
  await runCli(["import", "--from", client]);
}

export async function addServer(name: string, server: McpServer, force?: boolean): Promise<void> {
  const args = ["add", name, "--json", JSON.stringify(server)];
  if (force) args.push("--force");
  await runCli(args);
}

export async function removeServer(name: string, from?: string): Promise<void> {
  const args = ["remove", name];
  if (from) args.push("--from", from);
  await runCli(args);
}

export async function undoLast(): Promise<UndoResult> {
  const raw = await runCli(["undo", "--json"]);
  return JSON.parse(raw);
}

export async function reorderServers(client: string, order: string[]): Promise<void> {
  await runCli(["reorder", client, "--order", order.join(",")]);
}

export async function installCli(): Promise<string> {
  return invoke<string>("install_cli");
}

export async function uninstallCli(): Promise<void> {
  return invoke<void>("uninstall_cli");
}

export async function cliInstallStatus(): Promise<boolean> {
  return invoke<boolean>("cli_install_status");
}

export interface CustomClientConfig {
  configPath: string;
  rootKey: string;
  format: "json" | "toml" | "yaml";
}

export async function listCustomClients(): Promise<Record<string, CustomClientConfig>> {
  const raw = await runCli(["client", "list", "--json"]);
  return JSON.parse(raw);
}

export async function addCustomClient(id: string, cfg: CustomClientConfig): Promise<void> {
  await runCli(["client", "add", id,
    "--config-path", cfg.configPath,
    "--root-key", cfg.rootKey,
    "--format", cfg.format,
  ]);
}

export async function removeCustomClient(id: string): Promise<void> {
  await runCli(["client", "remove", id]);
}

export async function saveClientPaths(overrides: Record<string, string>): Promise<void> {
  for (const [client, p] of Object.entries(overrides)) {
    await runCli(["config", "set-path", client, p]);
  }
}

export async function unsetClientPath(client: string): Promise<void> {
  await runCli(["config", "unset-path", client]);
}

export async function setBackupTtlDays(days: number): Promise<void> {
  await runCli(["config", "set-backup-ttl", String(days)]);
}
