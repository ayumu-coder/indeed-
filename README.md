# indeed-automation — 面接リマインド送信 / メール LINE 転送 / 求人シート生成

このリポジトリには独立した 3 つのジョブが入っている。

| ジョブ | 内容 | エントリポイント | ワークフロー |
| --- | --- | --- | --- |
| リマインド送信 | 翌日面接の求職者へメールを毎日送る | `npm start` | `.github/workflows/daily-reminder.yml` |
| LINE 転送 | 特定の差出人からのメールを LINE へ通知する | `npm run forward` | `.github/workflows/gmail-line-forward.yml` |
| 求人シート生成 | PDF・画像などの求人資料を Indeed の求人入力シートにまとめる | `npm run joblisting` | 手動実行 |

以下は **リマインド送信**。
LINE 転送は [メール → LINE 自動転送](#メール--line-自動転送)、
求人シート生成は [求人資料 → Indeed 求人入力シート](#求人資料--indeed-求人入力シート) を参照。

---

## リマインドメール日次自動送信

`リマインドメール.gs` (Google Apps Script) の置き換え。
スプレッドシート「Quad求職者管理」を読み、**翌日に面接が入っている求職者へリマインドメールを毎日自動送信**する。

GAS への依存をやめ、GitHub Actions の cron で毎日 09:00 JST に実行する。
ロジックは純粋関数に分離してあり、`npm test` で送信せずに検証できる。

---

## 動作仕様

毎日 09:00 JST に全シートを走査し、**すべての条件を満たす行にだけ**送信する。

| 条件 | 既定値 | 制御する環境変数 |
| --- | --- | --- |
| `初回面接予定日` が「翌日」 | 翌日 | `REMIND_OFFSET_DAYS` |
| `面接設定可否` が `設定済み` | 有効 | `INTERVIEW_SCHEDULED_VALUES` |
| `リマインド可否` が空欄 | 有効 | `REMIND_FLAG_MODE` |
| `メールアドレス` が正しい形式 | 常に有効 | — |
| 送信ログに未記録 | 常に有効 | `LOG_SHEET_TITLE` |

送信後は `リマインド可否` に `実施` を書き戻し、非表示シート `_reminder_log` に
1 行ずつ記録する。**同じ人に二度送らない保証はこのログ側**にあり、書き戻しが失敗しても
重複送信は起きない。

### 列の対応付け

列は**位置ではなくヘッダー文字列**で解決する。列を差し込んでも並べ替えても壊れない。
ヘッダーは各シートの先頭 10 行から自動検出するため、KPI シートなど該当列を持たない
シートは自動的に無視される (`skipped: no-header`)。

| 内部名 | 受け付けるヘッダー | 必須 |
| --- | --- | --- |
| `candidateName` | 求職者名 / 氏名 / 名前 | ✅ |
| `email` | メールアドレス / メール / Email | ✅ |
| `interviewAt` | 初回面接予定日 / 面接予定日 / 面接日 | ✅ |
| `interviewScheduled` | 面接設定可否 | |
| `remindFlag` | リマインド可否 / リマインド | |
| `company` | 求人掲載企業 / 企業名 | |
| `jobTitle` | 応募職種 / 職種 | |
| `owner` | 担当者 | |

### 日付の解釈

`初回面接予定日` は次をすべて受け付ける。解釈できない値は **送らない** 側に倒す。

- `2026/07/28 0:00:00` / `2026-07-28` / `2026年7月28日`
- `5/13` — 年なしは前年・今年・翌年のうち今日に最も近い年に解決する
- Sheets のシリアル値 (`46231`)
- `未定`, `調整中`, 空欄 → 送信対象外

タイムゾーンは JST 固定 (`Asia/Tokyo`)。GitHub Actions の UTC ランナー上でも
「翌日」は JST の暦日で判定する。

---

## セットアップ

### 1. Google OAuth クライアントを作る

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIs & Services → Library** で **Google Sheets API** と **Gmail API** を有効化
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - 発行された Client ID / Client secret を控える
4. **OAuth consent screen** で、送信元にするアカウントを Test user に追加
   (Workspace 内部アプリなら不要)

### 2. リフレッシュトークンを取得する（ローカルで1回だけ）

```bash
npm install
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run authorize
```

表示された URL をブラウザで開き、**メールの送信元にしたい Google アカウント**で許可する。
`GOOGLE_REFRESH_TOKEN=1//...` が出力される。

要求スコープは 2 つだけ。受信メールは読めない。

- `spreadsheets` — シートの読み書き
- `gmail.send` — 送信のみ

### 3. スプレッドシートを共有する

手順 2 で認証したアカウントに、対象スプレッドシートの**編集権限**を付与する
(`_reminder_log` シートの作成と `リマインド可否` の書き戻しに必要)。

### 4. ローカルで DRY RUN

```bash
cp .env.example .env   # 値を埋める。DRY_RUN=true のまま
set -a && . ./.env && set +a
npm run dry-run
```

送信せずに、宛先・件名・本文と、行ごとのスキップ理由が JSON ログで出る。
`considered` が意図した人数と一致することを必ず確認する。

### 5. GitHub Actions に登録する

**Settings → Secrets and variables → Actions**

Secrets:

| 名前 | 値 |
| --- | --- |
| `SPREADSHEET_ID` | `1J312hSawdBlyyFfQYEWkK7siatN2f7zulwkWBKz1fhI` |
| `SENDER_ADDRESS` | 送信元アドレス |
| `GOOGLE_CLIENT_ID` | 手順 1 |
| `GOOGLE_CLIENT_SECRET` | 手順 1 |
| `GOOGLE_REFRESH_TOKEN` | 手順 2 |

Variables (任意):

| 名前 | 例 |
| --- | --- |
| `TARGET_SHEET_IDS` | `1972955214` |
| `SENDER_NAME` | `株式会社Quad` |
| `BCC_ADDRESSES` | `ops@quad-4.co.jp` |
| `REMIND_OFFSET_DAYS` | `1` |
| `REMIND_FLAG_MODE` | `skipIfMarked` |
| `MAX_SENDS_PER_RUN` | `50` |

登録後、**Actions → Daily reminder mail → Run workflow** を
`dry_run: true` のまま実行して結果を確認する。問題なければ以後は毎日自動で本送信される。

---

## メール文面を変える

`templates/reminder.subject.txt` と `templates/reminder.body.txt` を編集する。
使えるプレースホルダ:

`{{candidateName}}` `{{company}}` `{{jobTitle}}` `{{owner}}`
`{{interviewDate}}` (`2026年9月8日(火)`) `{{interviewTime}}` (`14:30`) `{{interviewDateTime}}`

未知のプレースホルダは置換されずそのまま残る。誤字が本番の空文になるのではなく、
dry run のログで目に見えるようにするため。

---

## 安全側の設計

- **`DRY_RUN` の既定値は `true`。** 環境変数の設定漏れで実際に送られることはない。
- **`MAX_SENDS_PER_RUN` (既定 50)** を超えると、1通も送らずに実行全体を中止する。
  列の対応付けが壊れて全行が対象化した場合の歯止め。
- **ヘッダーインジェクション対策。** シートの値に改行が混ざっていても、
  件名・宛先の改行は除去され、追加ヘッダーにはならない (テスト済み)。
- **メールアドレスの検証。** 表示名付き・カンマ区切り・空白入りは受理しない。
  1 セル = 1 宛先を保証する。
- **送信失敗は次回再送される。** ログに `sent` で記録された行だけが重複判定に使われる。
- **書き戻し失敗で実行は落とさない。** 配送は済んでおり、重複防止はログ側にあるため。
- 1 通でも失敗すると exit code 1 になり、Actions のジョブが赤くなる。

---

## 開発

```bash
npm test        # 型チェック + ユニットテスト (41 件、ネットワーク不要)
npm run typecheck
npm run dry-run
```

`src/domain/` は Google API に一切依存しない純粋ロジック。
`src/google/` が Sheets / Gmail のアダプタで、`src/ports.ts` のインターフェース経由で
`src/usecase/send-reminders.ts` に注入される。テストはすべてインメモリの差し替えで動く。

---

## 既知の判断ポイント

`リマインド可否` 列が「送ってよいか」なのか「送信済みか」なのかは、
既存データからは断定できなかった。既定の `skipIfMarked` は
**「値が入っている＝処理済みなので送らない」** と解釈する。この解釈だと
既存の全行が対象外になるため、初回導入で過去分に誤送信することはない。

逆の運用（オペレーターが `実施` を入れた行だけ送る）にしたい場合は
`REMIND_FLAG_MODE=requireMarked` にする。


---

# メール → LINE 自動転送

`y.shirai@linkup-c3.jp` から届いたメールを、LINE で **稲垣 広斗** さんへ自動通知する。

```
Gmail ─(10分ごとのポーリング)→ GitHub Actions ─(Messaging API push)→ LINE
                                     └→ 送信済みメールに Gmail ラベルを付与
```

## 動作仕様

1. `WATCH_SENDERS` 宛の受信メールのうち、`FORWARDED_LABEL` が付いていないものを検索する
2. `From` のアドレスを**完全一致で再検証**する (Gmail の `from:` は表示名にも当たるため)
3. 件名・差出人・受信時刻 (JST)・添付ファイル名・本文冒頭 `BODY_MAX_CHARS` 文字を LINE へ push する
4. push が成功したメールにだけラベルを付ける

**ラベルが重複防止の実体**。push → ラベルの順で処理するので、その間で落ちた場合は
次回 1 通だけ再通知される。逆順（先にラベル）だと push されなかったメールが
永久に埋もれるため、**取りこぼしより重複を選んでいる**。
さらに `X-Line-Retry-Key` を Gmail のメッセージ ID から決定的に生成しているので、
24 時間以内の再送は LINE 側でも重複排除される。

通知本文の例:

```
📩 新着メール
差出人: 白井 <y.shirai@linkup-c3.jp>
件名: 面接候補日のご連絡
受信: 2026年9月7日(月) 14:32
添付: 日程表.pdf
──────────
お世話になっております。
候補日は…
──────────
https://mail.google.com/mail/u/0/#all/18f2...
```

---

## セットアップ

### 1. LINE 公式アカウント (Messaging API) を作る

1. [LINE Developers](https://developers.line.biz/console/) でプロバイダーを作成
2. **Create a new channel → Messaging API** でチャネルを作成
3. **Messaging API 設定 → チャネルアクセストークン (長期)** を発行 → `LINE_CHANNEL_ACCESS_TOKEN`
4. 同画面の QR コードから、**稲垣さんに公式アカウントを友だち追加してもらう**
   (友だちでないユーザーには push できない)
5. 応答メッセージ (自動応答) は OFF にしておくと通知が静かになる

> **LINE Notify は 2025-03-31 で終了**しているため、Messaging API の push を使う。

### 2. 稲垣さんの `LINE_TO` (userId) を調べる

userId は LINE Developers の画面には出ない (そこに出るのは開発者自身の ID)。
Webhook で本人のイベントを 1 回受けて取り出す。

1. [webhook.site](https://webhook.site/) を開き、払い出された URL をコピー
2. LINE Developers → **Messaging API 設定 → Webhook URL** に貼り、**Webhook の利用を ON**
3. 稲垣さんに公式アカウントへ何か 1 通送ってもらう
4. webhook.site に届いた JSON の `events[0].source.userId` (`U` + 32 桁) が `LINE_TO`
5. **確認できたら Webhook の利用を OFF に戻す**

> userId は個人の識別子。webhook.site は第三者サービスなので、値を取得したら
> すぐに Webhook を切り、URL を破棄すること。社内にトンネル可能な環境があれば
> そちらの方が望ましい。
>
> 個人ではなくグループへ通知したい場合は、Bot をグループに招待して同じ手順で
> `groupId` (`C` + 32 桁) を取得し、`LINE_TO` に設定する。

取得したら本人確認とテスト送信をする:

```bash
LINE_CHANNEL_ACCESS_TOKEN=xxx LINE_TO=U... LINE_EXPECTED_DISPLAY_NAME='稲垣 広斗' \
  npm run line:verify -- --send
```

`displayName` が一致しなければ非ゼロ終了する。`--send` を付けるとテスト通知が飛ぶ。

### 3. Gmail を読む権限で再認可する

リマインド用のトークンは `gmail.send` しか持っていないため、**別のトークンが要る**。
**メールを受信しているアカウント**で認可する。

```bash
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run authorize forward
```

要求スコープは `gmail.modify` の 1 つだけ。ラベルの読み書きができる最小のスコープで、
`gmail.readonly` ではラベルを付けられない = 重複排除ができない。
**このスコープはメールボックスへの書き込み権限を含む**点は認識しておくこと
(このコードはラベル付与以外の変更を一切行わない)。

出力された値を `GMAIL_FORWARD_REFRESH_TOKEN` として登録する。

### 4. ローカルで DRY RUN

```bash
cp .env.example .env   # 値を埋める。DRY_RUN=true のまま
set -a && . ./.env && set +a
npm run forward:dry-run
```

`would push to LINE` として、実際に送られる文面がそのまま出る。
ラベルは付かないので、何度でも同じ結果で試せる。

### 5. GitHub Actions に登録する

**Settings → Secrets and variables → Actions**

Secrets:

| 名前 | 値 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | 手順 1 |
| `LINE_TO` | 手順 2 |
| `GMAIL_FORWARD_REFRESH_TOKEN` | 手順 3 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | リマインド側と共用 |

Variables:

| 名前 | 値 |
| --- | --- |
| `WATCH_SENDERS` | `y.shirai@linkup-c3.jp` |
| `FORWARD_LOOKBACK_MINUTES` (任意) | `1440` |
| `BODY_MAX_CHARS` (任意) | `700` |
| `MAX_PUSHES_PER_RUN` (任意) | `20` |

登録後、**Actions → Forward mail to LINE → Run workflow** を `dry_run: true` で実行し、
ログの `gmail search` の `matched` 件数と文面を確認する。問題なければ以後は自動で本送信される。

---

## 遅延とコスト

- **即時ではない。** cron は 10 分間隔で、GitHub のスケジューラ自体も数分遅れる。
  実際の通知は**受信から 5〜15 分後**とみておく。
- **間隔を詰めるほど Actions 時間を消費する。** 10 分間隔で約 144 回/日。
  1 回 40 秒として月あたり約 1,500 分。**プライベートリポジトリの無料枠 (2,000 分/月)
  をすぐ圧迫する**ので、5 分間隔にするなら課金状況を先に確認すること。
  パブリックリポジトリなら無料。
- **本当に即時が必要なら**、Gmail API の `users.watch` (Cloud Pub/Sub) + Cloud Run で
  push 型にする必要がある。常時稼働のインフラが増えるため、本実装では採用していない。
- **60 日間リポジトリに変更がないと、GitHub は scheduled workflow を自動停止する。**
  停止された場合は Actions 画面から手動で再有効化する。

---

## 安全側の設計

- **`DRY_RUN` の既定値は `true`。** 設定漏れで実際に通知が飛ぶことはない。
- **`MAX_PUSHES_PER_RUN` (既定 20)** を超えると、1 通も push せずに実行を中止する。
  検索条件が壊れて過去メールを全件拾った場合の歯止め。
- **`From` の完全一致検証。** Gmail の `from:` 検索は表示名や部分一致にも当たるため、
  取得後にアドレスを厳密照合する。
  ただし `From` ヘッダ自体は詐称可能で、**「そのアドレスから来たと書いてある」ことしか
  証明しない**。重要な判断に使うなら Gmail 側で SPF/DKIM 条件のフィルタを併用すること。
- **push 失敗時はそこで打ち切る。** トークン失効やブロックは後続も同じく失敗するため、
  ログを汚さず次回に持ち越す (未ラベルなので再送される)。
- **ラベル書き込み失敗は即座に落とす。** 重複排除の土台が書けない状態で走り続けると
  同じメールを延々と再通知するため。
- **サロゲートペアを壊さない切り詰め。** 絵文字や一部の漢字を UTF-16 単位で切ると
  不正な文字列になり LINE が 400 を返す。コードポイント単位で切っている。
- **LINE の 5,000 文字上限を必ず下回る。** 本文が長くても全体を再度切り詰める。
- **リトライは 429 / 5xx のみ**、`Retry-After` を尊重した指数バックオフ + ジッター。
  400 / 401 / 403 は設定ミスなので即座に失敗させる。

---

## 既知の制約

- **添付ファイルは転送しない。** ファイル名だけを通知する。LINE へファイルを送るには
  公開 HTTPS URL が必要で、社外に実体を置くことになるため意図的に対象外にした。
- **本文は先頭 `BODY_MAX_CHARS` 文字のみ。** 全文は Gmail リンクから読む。
- **HTML メールはタグを除去した簡易テキスト**になる。表やレイアウトは崩れる。
- **Gmail の検索対象は迷惑メール・ゴミ箱を除く。** 迷惑メール判定されたものは通知されない。

---

## 開発

```bash
npm test                 # 型チェック + ユニットテスト (106 件、ネットワーク不要)
npm run forward:dry-run
```

`src/domain/mime.ts` (MIME デコード) と `src/domain/line-message.ts` (文面生成) は
Google / LINE の API に一切依存しない純粋関数。`src/google/gmail-inbox.ts` と
`src/line/line-notifier.ts` がアダプタで、`src/ports.ts` の `MailInbox` / `Notifier`
経由で `src/usecase/forward-mail-to-line.ts` に注入される。


---

# 求人資料 → Indeed 求人入力シート

PDF の求人票、紙の求人票を撮った写真、テキストのメモ — 形式がばらばらな資料から、
Indeed の一括アップロード用シート `templates/indeed-job-upload.xlsx` の 1 行を作る。

```bash
# 複数の資料を 1 件の求人としてまとめる
npm run joblisting -- --out 求人.xlsx 求人票.pdf 職場写真.jpg メモ.txt

# 資料 1 件につき 1 求人として、複数行を一度に作る
npm run joblisting -- --out 求人.xlsx --split A社.pdf B社.pdf
```

対応形式: `.pdf` `.png` `.jpg` `.jpeg` `.gif` `.webp` `.txt` `.md` `.csv` `.tsv` `.json`。
PDF と画像は Messages API がそのまま読むので、OCR の前処理は要らない。

## 動作仕様

1. 資料を読み込む（1 ファイル 12 MB、1 回 24 MB まで。超えたら送信せずに落とす）。
2. Claude に 66 項目すべてを埋めさせる。**資料に書かれていない項目は空欄**にさせる。
3. Indeed が受け付けない値を捨てる。捨てた値は理由つきでログに出す。
   - 選択肢が決まっている項目（雇用形態、勤務形態、タグ…）で選択肢にない値
   - 金額・時間の項目で数値として読めない値（`要相談` など）
   - 郵便番号 7 桁、メールアドレス、電話番号の形式に合わない値
   - 上限を超えた値（タグ 3 個、職業カテゴリー 3 個、掲載画像 15 個）
4. Indeed が公開している雛形そのものに行を書き足して出力する。
   `例` タブも `入力方法` タブもヘッダー行も原本のまま残る。

**空欄は正常な出力**。埋まらなかった必須項目は `required fields left blank` として
ログに出るので、そこだけ人が埋める。推測で埋めることはしない。

## 出力の確認

```
{"level":"warn","message":"value dropped","field":"給与（最高額）","value":"応相談","reason":"not-a-number"}
{"level":"warn","message":"required fields left blank","fields":["fixedOvertimeUnit","plannedHires"]}
{"level":"info","message":"workbook written","out":"求人.xlsx","rows":1}
```

## 設定

`.env` の `ANTHROPIC_API_KEY` が必須。任意で `ANTHROPIC_MODEL`（既定
`claude-opus-5`）、`EXTRACTION_MAX_TOKENS`、`INDEED_TEMPLATE_PATH`。

## 既知の制約

- **Indeed の条件付き必須は判定しない。** 「雇用形態が業務委託なら給与形態は任意」といった
  条件分岐は追わず、無条件の必須項目だけを報告する。最終的な検証は Indeed 側に任せる。
- **職業カテゴリーは検証しない。** Indeed の職業カテゴリー一覧はこのリポジトリにないので、
  抽出された文字列をそのまま書く。取り込み時に弾かれたら手で直す。
- **`審査用の質問` と `自動アプローチ条件設定` は YAML をそのまま書く。** 構文検証はしない。
- **金額は単体の数値表記のみ解釈する。** `25万円` `1,200` は読むが、`20万〜30万` のような
  範囲表記は最低額・最高額のどちらとも決められないので空欄にして警告を出す。
- **セル幅・折り返しは設定しない。** 長文セルは Excel 上で 1 行に見えるが、値は完全なもの。

## 開発

```bash
npm test   # 型チェック + ユニットテスト。API も雛形の書き換えも要らない
```

`src/joblisting/schema.ts` が唯一の定義元で、列の順序・選択肢・必須は雛形の `入力方法`
タブから起こしてある。`src/joblisting/posting.ts`（値の正規化）と
`src/joblisting/workbook.ts` + `zip.ts`（.xlsx の書き換え）は API に一切依存しない純粋関数。
`src/joblisting/extractor.ts` が `JobExtractor` ポートの Anthropic 実装で、
`src/usecase/build-job-listing-sheet.ts` に注入される。
