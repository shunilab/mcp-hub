# 失敗パターン

過去のハマりどころ・やってはいけないことを記録する。
書き込む前に [rules.md](./rules.md) の判断基準・重複チェック手順に従うこと。

エントリ形式:

```markdown
### エントリのタイトル
作成: YYYY-MM-DD / 確認: YYYY-MM-DD

何をしたら何が起きたか、なぜ避けるべきか、代わりにどうすべきか
```

---

<!-- ここから下にエントリを追記する -->

### tauri dev は target/debug/cli.cjs を最優先で使う。CLI変更が反映されない白画面の原因になる
作成: 2026-07-17 / 確認: 2026-07-17

`find_cli`（`packages/app/src-tauri/src/lib.rs`）は (1) バンドルリソース `cli.cjs`、(2) `MCP_HUB_CLI` 環境変数、(3) `packages/cli/dist/index.js`（dev heuristic）の順で探す。`tauri dev` 実行時、過去に一度でも `tauri build` 相当のリソースコピーが走っていると `packages/app/src-tauri/target/debug/cli.cjs`（`tauri.conf.json` の `resources` マッピングで `../../cli/dist/bundle.cjs` からコピーされたもの）が残り続け、**`pnpm --filter @mcp-hub/cli build` で `dist/index.js` を更新しても `target/debug/cli.cjs` は自動更新されず、そちらが優先して使われ続ける**。

このズレに気づかず、フロントエンドが新しい `StatusResult` フィールド（例: `drifted`）を前提にレンダリングすると、実行時に古いCLIの応答（該当フィールド無し）で例外が起き、React全体がクラッシュして画面が真っ白になる。エラーはネイティブWKWebViewのconsoleにしか出ず、Rust側のターミナルログにもVite HMRログにもエラーが一切出ないため、原因特定に時間がかかる。

**How to apply**: CLI側の型・フィールドを変更した後に `tauri dev` で白画面や不可解な挙動が出たら、まず `packages/cli/dist/bundle.cjs`（`pnpm --filter @mcp-hub/cli build:bundle`）を再生成し、`packages/app/src-tauri/target/debug/cli.cjs` へ手動でコピーして最新化することを試す。恒久対策として、CLIの型を消費するフロント側コードは `?? []` 等でオプショナルに扱い、フィールド欠落だけではクラッシュしない防御的な書き方にしておくとよい（実施済み: `LibraryView.tsx` の `cardBadges`）。
