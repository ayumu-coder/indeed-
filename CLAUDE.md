# CLAUDE.md

## プロジェクト概要

Indeed 経由の応募者向け面接リマインドメール送信 (`src/main.ts`) と、監視対象送信者からのメールを LINE へ転送する処理 (`src/forward-main.ts`)。
TypeScript / Node 22 (`--experimental-strip-types`)。GitHub Actions で実行 (リマインドは日次 09:00 JST `daily-reminder.yml`、LINE 転送は 10 分毎 `gmail-line-forward.yml`)。テストは `npm test`。

## Markdown (*.md) の運用ルール — 必読

**Markdown ファイルの作成・編集・削除・移動は「md 監査役」セッションのみが行う。**
それ以外のセッション (人間の対話セッション、他の Routine、サブエージェント) は md を書き込まない。

- 強制手段: `.claude/settings.json` の PreToolUse フック (`scripts/md-guard.ts`) が、監査役以外のセッションからの
  Write / Edit / MultiEdit / NotebookEdit / Bash / GitHub MCP (create_or_update_file, delete_file, push_files) による md 書き込みを拒否する。
  監査役セッションの ID は `.claude/md-auditor.json` の `auditorSessionIds` で管理する。
- md の変更が必要になった場合は、`.claude/md-requests/TEMPLATE.txt` を複製して
  `.claude/md-requests/YYYYMMDD-<slug>.txt` に依頼を書く (対象ファイル / 変更内容 / 理由)。
  監査役が日次 (09:00 JST) に処理し、処理済み依頼ファイルは削除する。
- フックの迂回 (`.claude/settings.json` や `.claude/md-auditor.json` の書き換え、`MD_AUDITOR` の設定、
  md 以外の拡張子で保存してから rename する等) は禁止。拒否されたらコードの変更だけを完了し、依頼ファイルを残す。
- 監査役の作業記録: `docs/md-audit-log.md`、md 一覧: `docs/MD_INDEX.md` (どちらも監査役が管理)。

## 監査役セッションの責務 (監査役のみ適用)

1. 毎日 `.claude/md-requests/*.txt` を処理する (妥当なら反映、不適切なら却下理由を監査ログに残す)。
2. リポジトリ内の全 md を精読し、コードとの矛盾・重複・リンク切れ・古い記述・構成の不統一を修正/統合/削除する。
3. 変更は md ファイルと `.claude/md-requests/` 配下のみ。それ以外の差分は作らない。
4. `git diff --stat` で対象を確認してから commit (`docs(md-audit): YYYY-MM-DD`) し push する。PR は作らない。
