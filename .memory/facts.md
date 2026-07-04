# 事実

このプロジェクトの設計判断・理由・技術的制約・規約を記録する。
書き込む前に [rules.md](./rules.md) の判断基準・重複チェック手順に従うこと。

エントリ形式:

```markdown
### エントリのタイトル
作成: YYYY-MM-DD / 確認: YYYY-MM-DD

本文（理由・背景・適用条件を含める）
```

---

### プロダクト概要と構成
作成: 2026-07-04 / 確認: 2026-07-04

mcp-hubは、複数AIエージェント（Claude Code, Claude Desktop, Cline, Roo Code, OpenCode, Codex）に散らばったMCP設定を一元管理するツール。CLI + Tauriデスクトップアプリの構成。

- `packages/cli` — Node.js/TypeScript CLIコア（import/sync/status/undo/add/remove/list）
- `packages/app` — Tauri v2 + React + Vite デスクトップアプリ（Library: master+クライアントのカラム+DnD／Discover: MCPレジストリ連携+手動追加フォーム／Settings: クライアントパス・バックアップ設定）
- ハブ設定: `~/.mcp-hub/servers.json`（mcpServers形式）
- バックアップ: `~/.mcp-hub/backups/` に自動保存・7日後削除

### バージョンファイルは4箇所を手動同期する必要がある
作成: 2026-07-04 / 確認: 2026-07-04

バージョン番号はルート/cli/app/tauri.conf.jsonの4箇所に存在し、自動同期の仕組みがない。リリース時は手動で4箇所を揃えてからタグを作成する。

**How to apply**: 次にリリースする際は、まず4箇所のバージョンが揃っているか確認してからタグを切る。自動化スクリプト/CIチェックの導入は未着手の改善候補。

### draft releaseの上書きは先に削除してから再作成する
作成: 2026-07-04 / 確認: 2026-07-04

draft releaseのURLは`untagged-<hash>`表記になる（GitHubのdraft release仕様、draftはタグrefに紐付かないため）。publish時に正しいタグURLに切り替わる。再ビルドのたびにhashが変わるため、上書き時は古いdraftを先に削除しないと重複draftが残る。

**How to apply**: 同バージョンで再ビルド・再タグする場合は `gh release delete` → タグ`push --delete` → 再作成の順で行う（force-pushはしない）。
