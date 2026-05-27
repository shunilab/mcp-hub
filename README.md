# MCPHub

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/momexn/mcp-hub)](https://github.com/momexn/mcp-hub/releases)

MCP (Model Context Protocol) サーバー設定を複数の AI クライアント間で一元管理するデスクトップアプリ + CLI ツール。

## 概要

MCPHub は **マスター設定** (`~/.mcp-hub/servers.json`) を中心に、各クライアントの設定ファイルへ双方向に同期します。GUI のドラッグ&ドロップで直感的に操作できるほか、CLI でスクリプトからも利用できます。

## 対応クライアント

| クライアント | macOS | Windows |
|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude.json` | `%USERPROFILE%\.claude.json` |
| Cline | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| Roo Code | `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json` |
| OpenCode | `~/.config/opencode/opencode.json` | `%APPDATA%/opencode/opencode.json` |
| Codex | `~/.codex/config.toml` | `%USERPROFILE%/.codex/config.toml` |

## インストール

### デスクトップアプリ

[Releases](https://github.com/momexn/mcp-hub/releases) から各 OS のインストーラーをダウンロードしてください。

- **macOS**: `.dmg` (Universal Binary — Apple Silicon / Intel 両対応)
- **Windows**: `.msi`
- **Linux**: `.AppImage`

### CLI のみ

アプリの **Settings → Install CLI to PATH** を使うか、CLI パッケージをビルドして手動で配置してください。インストール後:

```bash
mcp-hub --help
```

## CLI 使い方

```bash
# マスターにサーバーを追加
mcp-hub add my-server --command npx --args "-y @modelcontextprotocol/server-fetch"

# マスター → 全クライアントへ同期
mcp-hub sync

# 特定クライアントへだけ同期
mcp-hub sync --to claude-desktop

# クライアントの設定をマスターに取り込む
mcp-hub import --from cline

# 全クライアントとマスターの差分を確認
mcp-hub status

# 直前の変更を元に戻す
mcp-hub undo
```

### sync コマンドのパターン

| コマンド | 動作 |
|---|---|
| `mcp-hub sync` | マスター → 全クライアント |
| `mcp-hub sync --to claude-code` | マスター → 指定クライアント |
| `mcp-hub sync --from cline --to master` | クライアント → マスター |
| `mcp-hub sync --from all` | 全クライアント → マスター |
| `mcp-hub sync --server my-server --to claude-code` | 1 サーバーだけ同期 |

## GUI の使い方

### Library ビュー

- 左端の **Master** 列がマスター設定、右側に各クライアント列が並ぶ
- サーバーカードをドラッグして別の列にドロップ → **移動 (move)**
- **Cmd/Ctrl を押しながらドロップ** → **コピー**
- 列ヘッダーをドラッグして列の並び順を変更
- 右クリックでコンテキストメニュー (移動先選択 / 削除 / 設定ファイルを開く)
- **Cmd+Z**: undo、**Cmd+R**: 再読み込み

### Discover ビュー

公式 MCP サーバーリポジトリと Smithery レジストリからサーバーを検索し、ワンクリックでマスターに追加できます。

### Settings ビュー

- CLI の PATH へのインストール / アンインストール
- 各クライアントの設定ファイルパスを上書き

## 設定ファイルの形式

### servers.json（マスター設定）

`~/.mcp-hub/servers.json` がすべての設定の基点です:

```json
{
  "version": 1,
  "mcpServers": {
    "my-fetch-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"]
    },
    "my-remote-server": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

### カスタムクライアントの追加

`~/.mcp-hub/clients.json` に追記することでカスタムクライアントを追加できます:

```json
{
  "my-client": {
    "configPath": "~/path/to/config.json",
    "rootKey": "mcpServers",
    "format": "json"
  }
}
```

| フィールド | 説明 |
|---|---|
| `configPath` | 設定ファイルのパス（`~/` 展開対応。OS 別指定は `{ "darwin": "...", "win32": "..." }` 形式） |
| `rootKey` | MCP サーバー一覧が格納されているキー名（例: `"mcpServers"`） |
| `format` | ファイル形式: `"json"` / `"toml"` / `"yaml"` |

## トラブルシューティング

### `mcp-hub: command not found`

Settings → **Install CLI to PATH** を実行後、シェルを再起動してください。手動で追加する場合は `~/.mcp-hub/bin` を `PATH` に追加します。

### Tauri dev 起動時に `cli.cjs not found` エラー

CLI を先にビルドする必要があります:

```bash
pnpm --filter @mcp-hub/cli build
```

### 設定ファイルが見つからない（Cline / Roo Code）

VSCode を一度起動して対象の拡張機能をインストールすると設定ファイルが生成されます。パスは上記「対応クライアント」テーブルを参照してください。

### 変更を誤って同期してしまった

```bash
mcp-hub undo
```

変更前のバックアップから復元されます。

## 開発

**前提条件**: Node.js 20+、pnpm 11.2.2+、Rust (stable)

```bash
# 依存関係インストール
pnpm install

# CLI をビルド (Tauri dev 実行前に必須)
pnpm --filter @mcp-hub/cli build

# Tauri アプリを開発モードで起動
pnpm --filter @mcp-hub/app tauri dev
```

詳細なアーキテクチャと内部構造は [CLAUDE.md](./CLAUDE.md) を参照してください。

## ライセンス

[MIT](LICENSE)
