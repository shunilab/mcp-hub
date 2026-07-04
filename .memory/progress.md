# 進捗

現在の作業状態と次に取るべきアクションのみを保持する。完了した項目は都度削除し、蓄積させない（[rules.md](./rules.md) 3.肥大化対策）。

---

## 現在の状態

- v0.1.5リリース済み（GitHub Releaseはdraftのまま、**未公開・publishはユーザー判断待ち**）
- コードレビューで検出したHigh 7件・Med 12件を6つのテーマ別PRに分けてすべてmainへマージ済み
- LibraryViewの横スクロール時の「裂け目」バグ（フェード用`::after`のposition:absolute配置ミス）を修正済み（`App.css`/`LibraryView.tsx`、コミット`0ac6e4d`）
- CIビルド（macOS universal / Windows x64 / Ubuntu x64）は3プラットフォームとも成功。`gh release view v0.1.5`でisDraft:true・アセット7件・重複draftなしを確認済み
- GUIの対話的クリックテスト（DnD・ボタン操作の実操作）は実データ保護のため意図的に未実施。レンダリング確認とPlaywrightでのスタンドアロンHTML CSS検証のみ

## 次のアクション

1. まず `gh release view v0.1.5 --json isDraft` でdraft releaseが公開されたかどうかを確認する
2. 未公開ならユーザーにpublish判断を確認する
3. GUIの対話的動作確認（DnD・Undo・Settings保存など）を実機で実施
4. バージョンファイル同期を自動化するスクリプト/CIチェックの検討

