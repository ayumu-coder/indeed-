# md 監査ログ

md 監査役セッションの日次作業記録。直近 30 日分のみ保持し、古いエントリは削除する。

## 2026-09-18

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 9bb4ad8) 以降、作業ブランチにコード変更なし。作業ブランチ上の md とコードの矛盾・リンク切れなし。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断:
  - デフォルトブランチ `claude/auto-forward-email-line-16l2qv` の commit 01b5574 で `.github/workflows/daily-reminder.yml` と `gmail-line-forward.yml` が削除された。作業ブランチ `claude/jolly-lovelace-zg4t4e` にはワークフローが残っており、`CLAUDE.md` の「GitHub Actions で実行」の記述は作業ブランチのコードとは整合するがデフォルトブランチとは乖離している。作業ブランチをデフォルトブランチへ統合する際に、`CLAUDE.md` の実行方式の記述を見直す必要がある (統合方針が決まっていないため監査役は書き換えない)。
  - (継続) 作業ブランチの `.github/workflows/gmail-line-forward.yml` の cron コメントの README 参照 (削除済み) は未対応。デフォルトブランチでは当該ファイル自体が削除されたため、統合後は自然消滅する見込み。

## 2026-09-17

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit eb2d0a2) 以降、作業ブランチにコード変更なし。md とコード (src/, scripts/, .github/workflows/, package.json) の矛盾・リンク切れなし。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続):
  - `.github/workflows/gmail-line-forward.yml` の cron コメントの README 参照 (削除済み) は未対応のまま。

## 2026-09-16

- 確認した md: 1 件 (`CLAUDE.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 実施した変更:
  - `CLAUDE.md`: 「GitHub Actions で日次実行」を実態に合わせて修正 (リマインドは日次、LINE 転送は 10 分毎)。フックの拒否対象ツールを `scripts/md-guard.ts` の実装に合わせて列挙。
  - `docs/MD_INDEX.md`: 新規作成 (CLAUDE.md から参照されていたが未作成だった)。
  - `docs/md-audit-log.md`: 新規作成 (同上)。
- 却下した依頼: なし。
- 要人間判断:
  - `.github/workflows/gmail-line-forward.yml` の cron コメントが「README「遅延とコスト」」を参照しているが、README.md は commit 803454a で削除済み。md 以外のファイルのため監査役は修正しない。コード側でコメントを修正するか、該当内容を md として復活させるかを判断されたい。
