import { z } from "zod";

export const McpServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export const HubConfigSchema = z.object({
  version: z.literal(1),
  mcpServers: z.record(McpServerSchema),
});

export const ClientConfigSchema = z.object({
  configPath: z.union([
    z.string(),
    z.object({
      darwin: z.string(),
      win32: z.string(),
      linux: z.string().optional(),
    }),
  ]),
  rootKey: z.string(),
  format: z.enum(["json", "toml", "yaml"]),
});

export const UserClientsSchema = z.record(ClientConfigSchema);

export type McpServer = z.infer<typeof McpServerSchema>;
export type HubConfig = z.infer<typeof HubConfigSchema>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type UserClients = z.infer<typeof UserClientsSchema>;

export interface SyncOptions {
  from?: string;
  to?: string;
}
