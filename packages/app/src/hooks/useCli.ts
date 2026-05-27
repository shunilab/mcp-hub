import { invoke } from "@tauri-apps/api/core";

export async function runCli(args: string[]): Promise<string> {
  return invoke<string>("run_cli", { args });
}

export interface McpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface ClientStatus {
  name: string;
  configPath: string;
  servers: Record<string, McpServer>;
  configExists: boolean;
  shared: string[];
  masterOnly: string[];
  clientOnly: string[];
}

export interface StatusResult {
  master: Record<string, McpServer>;
  masterConfigPath: string;
  clients: ClientStatus[];
}

export async function fetchStatus(): Promise<StatusResult> {
  const raw = await runCli(["status", "--json"]);
  return JSON.parse(raw);
}

export async function syncFromTo(from?: string, to?: string, server?: string): Promise<void> {
  const args = ["sync"];
  if (from) args.push("--from", from);
  if (to) args.push("--to", to);
  if (server) args.push("--server", server);
  await runCli(args);
}

export async function importFrom(client: string): Promise<void> {
  await runCli(["import", "--from", client]);
}

export async function addServer(name: string, server: McpServer): Promise<void> {
  const args = ["add", name];
  if (server.command) args.push("--command", server.command);
  if (server.args?.length) args.push("--args", server.args.join(" "));
  if (server.url) args.push("--url", server.url);
  if (server.env && Object.keys(server.env).length) {
    args.push("--env", Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join(","));
  }
  await runCli(args);
}

export async function removeServer(name: string, from?: string): Promise<void> {
  const args = ["remove", name];
  if (from) args.push("--from", from);
  await runCli(args);
}

export async function undoLast(): Promise<void> {
  await runCli(["undo"]);
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
