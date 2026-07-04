# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

MCPHub is a monorepo desktop app for managing MCP (Model Context Protocol) server configurations across multiple AI clients (Claude Desktop, Claude Code, Cline, Roo Code, OpenCode, Codex, etc.). It has two packages:

- `packages/cli` — Node.js CLI (`@mcp-hub/cli`) that reads/writes MCP config files via adapters
- `packages/app` — Tauri v2 + React 19 + TypeScript desktop app that embeds and drives the CLI

**Package manager: pnpm (v11.2.2 required)**

## Commands

### CLI package
```bash
pnpm dev:cli          # Watch-compile CLI TypeScript
pnpm --filter @mcp-hub/cli build          # Compile TypeScript → dist/
pnpm --filter @mcp-hub/cli build:bundle   # Bundle for Tauri embedding → dist/bundle.cjs
```

### App package
```bash
pnpm dev:app          # Vite dev server only (no Tauri shell)
pnpm --filter @mcp-hub/app tauri dev      # Full Tauri dev (requires CLI built first)
pnpm --filter @mcp-hub/app tauri build    # Production Tauri bundle
```

### Before running the Tauri app in dev mode
The Tauri backend looks for `packages/cli/dist/index.js` at runtime. Build the CLI first:
```bash
pnpm --filter @mcp-hub/cli build && pnpm --filter @mcp-hub/app tauri dev
```

## Architecture

### Data flow
```
GUI (React) → useCli.ts → Tauri invoke("run_cli") → lib.rs → node cli.cjs <args> → stdout/stderr back
```

The Tauri backend (`src-tauri/src/lib.rs`) spawns Node.js with the bundled CLI as a child process for every operation. The frontend parses the JSON output from `mcp-hub status --json`.

### CLI adapter system
`packages/cli/src/adapters/` implements the `Adapter` interface (`base.ts`) for each supported client. Built-in adapters cover `claude-desktop`, `claude-code`, `cline`, `roo-code`, `opencode`, `codex`. User-defined adapters are loaded from `~/.mcp-hub/clients.json` with the schema `Record<id, { configPath: string | { darwin, win32 }, rootKey: string, format: "json"|"toml"|"yaml" }>`.

Note: `opencode` and `codex` have custom read/write logic (opencode nests under `.mcp`, codex uses TOML with `.mcp_servers` key).

### Hub config (master store)
The CLI maintains a single source of truth at `~/.mcp-hub/servers.json` (`HubConfig`, version 1). The top-level key for server entries is `mcpServers` (not `servers`). All sync operations read/write against this file plus the target client's config file. Backups are written before mutations; `undo` restores the most recent backup.

### GUI views
- **LibraryView** — multi-column kanban-style view, one column per client. Drag-and-drop between columns calls `sync` + optional `remove`. Hold Cmd/Ctrl for copy-only mode. Cmd+Z → undo, Cmd+R → refresh.
- **DiscoverView** — browse/install MCP servers from official registry and Smithery.
- **SettingsView** — install/uninstall the CLI shim to PATH, manage custom clients.

### Tauri → CLI resolution order (lib.rs `find_cli`)
1. Bundled resource `cli.cjs` in the `.app` bundle
2. `MCP_HUB_CLI` env var override
3. `packages/cli/dist/index.js` relative to executable (dev mode heuristic)
4. `~/.mcp-hub/cli/index.js` (home dir fallback)

### Release workflow
`.github/workflows/release.yml` builds on macOS, Windows, and Ubuntu, signs with Tauri's updater key, and publishes GitHub releases with installers. The workflow bundles `cli/dist/bundle.cjs` into the Tauri resources before building.

<!-- agent-mem -->
このプロジェクトには `.memory/` があります。作業前に `.memory/index.md` を読んでください。
