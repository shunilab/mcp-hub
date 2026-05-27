import { McpServer } from "../types.js";

export interface Adapter {
  name: string;
  configPath(): string;
  read(): Record<string, McpServer> | null;
  write(servers: Record<string, McpServer>): string | null;
  merge(existing: Record<string, McpServer>, incoming: Record<string, McpServer>): Record<string, McpServer>;
}

export function defaultMerge(
  existing: Record<string, McpServer>,
  incoming: Record<string, McpServer>
): Record<string, McpServer> {
  return { ...existing, ...incoming };
}
