# indeed-reminder — 面接リマインドメール日次自動送信

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
