import chalk from "chalk";
import { loadHub, saveHub } from "../hub.js";
import { getAdapter } from "../adapters/index.js";

export function reorder(client: string, options: { order: string }) {
  const names = options.order.split(",").map((s) => s.trim()).filter(Boolean);

  if (client === "master") {
    const hub = loadHub();
    const existing = hub.mcpServers;
    const reordered: typeof existing = {};
    for (const name of names) {
      if (name in existing) reordered[name] = existing[name];
    }
    for (const [k, v] of Object.entries(existing)) {
      if (!(k in reordered)) reordered[k] = v;
    }
    hub.mcpServers = reordered;
    saveHub(hub);
  } else {
    const adapter = getAdapter(client);
    if (!adapter) {
      console.error(chalk.red(`Unknown client: ${client}`));
      process.exit(1);
    }
    const existing = adapter.read() ?? {};
    const reordered: typeof existing = {};
    for (const name of names) {
      if (name in existing) reordered[name] = existing[name];
    }
    for (const [k, v] of Object.entries(existing)) {
      if (!(k in reordered)) reordered[k] = v;
    }
    adapter.write(reordered);
  }

  console.log(chalk.green(`✓ Reordered ${client}`));
}
