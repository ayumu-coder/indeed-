# md 監査ログ

md 監査役セッションの日次作業記録。直近 30 日分のみ保持し、古いエントリは削除する。

## 2026-09-30

- 確認した md: 17 件 (`CLAUDE.md`, `docs/` 2 件, `部/` 8 件, `メモリ/` 5 件, `予定表.md`)。未追跡 md なし。
- 依頼キュー: 2 件を反映し、依頼ファイルを削除 (いずれも依頼元: 部長くん session_011ka9AiqKz8z7uGm3J3x6Dy)。
  - `20260929-tool-permission-rule.txt`: ツール使用許可は確認しない旨を `部/業務部/CLAUDE.md` ルールと `メモリ/勝手にやらない.md` 冒頭に追記。
  - `20260929-windows-and-ledger.txt`: 「Mac」→「Windows PC」の事実訂正 (`CLAUDE.md`, `部/基盤部/`, `部/数値更新部/`, `部/業務部/`, `メモリ/勝手にやらない.md`)、基盤部に LINE自動応答くんを追加 (参照 commit cf31bb5 はデフォルトブランチに実在することを確認)、業務部・基盤部の作業記録と予定表を更新。
- 依頼からの逸脱:
  - `予定表.md`: 依頼の「10/3 まで | 10月タブ作成の可否」は既存の「10/1 | 10月タブ作成の可否を再確認」と同じ用事のため、1 行に統合 (同じことは 1 か所の原則)。
  - `部/数値更新部/CLAUDE.md` 現状: 依頼外だが、業務部台帳の「9/26〜27 分 完了」と矛盾する「9/25 まで転記済み・9/26〜 実行中」を「9/27 まで転記済み」に更新。
  - `部/基盤部/CLAUDE.md` 持ち物: `line-autoreply/` は作業ブランチには無くデフォルトブランチにあるため、その旨を明記。
- 実施した変更 (上記のほか): `docs/MD_INDEX.md` の最終監査日と基盤部の目的を更新、本エントリを追記。
- 却下した依頼: なし。
- 要人間判断:
  - (新規) デフォルトブランチ commit cf31bb5 で `line-autoreply/README.md` が md 監査役を経由せず作成された。作業ブランチには無いため監査役は触っていない。デフォルトブランチ側に md ガードが無い状態を許容するか、統合時に監査対象へ取り込むかの判断が必要。
  - (継続、2026-09-18 参照) デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。
  - (継続) 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-29

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 前回監査 (commit 8e7bfe7) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 依頼キュー (日次監査後にユーザー指示で臨時処理): `20260929-dept-notes-init.txt` (依頼元: 部長くん session_011ka9AiqKz8z7uGm3J3x6Dy、ユーザー決定 2026-09-29) を反映し、依頼ファイルを削除。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新、新規 14 ファイルを追加。
  - `docs/md-audit-log.md`: 本エントリを追記。
  - `CLAUDE.md`: 節「部の一覧 (全体目次)」を追加 (表 + ノートの読み方)。運用ルールに上限と整理ルールを追記。監査役の責務 2 に `部/`・`メモリ/`・`予定表.md` の整理を追記。
  - 新規: `部/{業務部,求人作成部,数値更新部,基盤部}/CLAUDE.md` (目次 + ルール/持ち物/現状)、同 `作業記録.md` (表のみ、初期行は業務部のみ)。
  - 新規: `メモリ/MEMORY.md`、`メモリ/返事の型.md`、`メモリ/勝手にやらない.md`、`メモリ/求人原稿の禁止事項.md`、`メモリ/数値シートの触り方.md`。
  - 新規: `予定表.md`。
- 却下した依頼: なし。依頼からの逸脱は 1 点のみ: 「ノートの読み方」3 行の前に、依頼の【方針】にあった「ノートは監査役ブランチにあり他セッションは `git show` で読む」を 1 行追記した (読み手が場所を知る必要があるため)。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-28

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 1909543) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-27

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 8aaef8f) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-26

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit dcd5842) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-25

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 336e796) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-24

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 52f0375) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-23

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 611a561) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-22

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 9fffbcd) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-21

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 7102fb4) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイルはすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-20

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit a705932) 以降、作業ブランチ・デフォルトブランチともに変更なし。md が参照するファイル (src/, scripts/, .claude/, .github/workflows/) はすべて実在し、記述と整合。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

## 2026-09-19

- 確認した md: 3 件 (`CLAUDE.md`, `docs/MD_INDEX.md`, `docs/md-audit-log.md`)。未追跡 md なし。
- 依頼キュー: 依頼なし (`TEMPLATE.txt` のみ)。
- 前回監査 (commit 1a56a41) 以降、作業ブランチ・デフォルトブランチともに変更なし。作業ブランチ上の md とコードの矛盾・リンク切れなし。
- 実施した変更:
  - `docs/MD_INDEX.md`: 最終監査日を更新。
  - `docs/md-audit-log.md`: 本エントリを追記。
- 却下した依頼: なし。
- 要人間判断 (継続、2026-09-18 のエントリ参照):
  - デフォルトブランチでの GitHub Actions ワークフロー削除 (commit 01b5574) と `CLAUDE.md` の「GitHub Actions で実行」記述の乖離。統合方針が未定のため未対応。
  - 作業ブランチの `gmail-line-forward.yml` の cron コメントにある削除済み README への参照。

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
