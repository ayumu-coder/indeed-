# CLAUDE.md

## プロジェクト概要

Indeed 経由の応募者向け面接リマインドメール送信 (`src/main.ts`) と、監視対象送信者からのメールを LINE へ転送する処理 (`src/forward-main.ts`)。
TypeScript / Node 22 (`--experimental-strip-types`)。GitHub Actions で実行 (リマインドは日次 09:00 JST `daily-reminder.yml`、LINE 転送は 10 分毎 `gmail-line-forward.yml`)。テストは `npm test`。

## 部の一覧 (全体目次)

Claude セッション群を「会社の部」として運用する。決まりの本文は各部のノートにあり、ここには書かない。

| 部名 | 担当セッション | ノートの場所 | 持ち物の要約 |
| --- | --- | --- | --- |
| 業務部 | 部長くん (session_011ka9AiqKz8z7uGm3J3x6Dy) | `部/業務部/` | 全体の仕組み・部下の統括・ノート運用 |
| 求人作成部 | 求人作成くん (session_01UY9p3ZLrVNSrQBBYfzr7Gd)、エンルーツ slack連携 (session_01DanMVAJwu6La2dcNy3u768) | `部/求人作成部/` | Indeed 求人原稿 (v14 形式 CSV) の作成 |
| 数値更新部 | 数値更新くん (session_01DZFsJBeNUAFmoS2ewYTknw、Windows PC 上) | `部/数値更新部/` | Indeed 日次数値の転記 (indeed-update) |
| 基盤部 | hr-platform・ユーザー登録とログイン確認 (Windows PC 上)、LINE自動応答くん (session_01MWBCXuxUciuJANbsmG4zxF、クラウド、ブランチ `claude/auto-forward-email-line-16l2qv`) | `部/基盤部/` | hr-platform アプリ・公開 URL・Windows 常駐化・LINE 自動応答 (GAS) |
| md 監査役 | 本セッション (`.claude/md-auditor.json` 参照) | `docs/` | md の整理係 (夜の整理係を兼務) |

共通ノート: `メモリ/MEMORY.md` (目次) と `メモリ/*.md`、`予定表.md`。ノートは監査役ブランチ `claude/jolly-lovelace-zg4t4e` にあり、他ブランチのセッションは `git show` で読む (マージしない)。

ノートの読み方:

- (a) 各部長は自分の部のノートだけ読む。
- (b) 他部のノートは読まない・書かない。
- (c) 変更は md 監査役への依頼 (`.claude/md-requests/` の依頼ファイル) で行う。

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
- 上限と整理ルール: ノート 1 冊 200 KB まで、メモリ目次 (`メモリ/MEMORY.md`) 150 行まで、メモリ 1 冊の本文 30 行まで。
  同じことは 1 か所 (正本) にだけ書く。足すときはテーマの節に 1 行。古い行は各部の `作業記録.md` へ移す。
  日付見出しで積み上げない。会話の引用をそのまま残さない。プログラムの中身は書かない。

## 監査役セッションの責務 (監査役のみ適用)

1. 毎日 `.claude/md-requests/*.txt` を処理する (妥当なら反映、不適切なら却下理由を監査ログに残す)。
2. リポジトリ内の全 md を精読し、コードとの矛盾・重複・リンク切れ・古い記述・構成の不統一を修正/統合/削除する。
   `部/`、`メモリ/`、`予定表.md` も対象とし、重複の統合・古い行の `作業記録.md` への移動・上限超過分の削減を行う。
3. 変更は md ファイルと `.claude/md-requests/` 配下のみ。それ以外の差分は作らない。
4. `git diff --stat` で対象を確認してから commit (`docs(md-audit): YYYY-MM-DD`) し push する。PR は作らない。
