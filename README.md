# indeed-reminder — 面接リマインドメール日次自動送信

`リマインドメール.gs` (Google Apps Script) の置き換え。
スプレッドシート「Quad求職者管理」を読み、**翌日に面接が入っている求職者へ、担当者本人のアドレスから**
リマインドメールを毎日自動送信する。

GitHub Actions の cron で毎日 09:00 JST に実行。判定ロジックは純粋関数に分離してあり、
`npm test` で1通も送らずに検証できる。

---

## 動作仕様

毎日 09:00 JST に全シートを走査し、**すべての条件を満たす行にだけ**送信する。

| 条件 | 既定値 | 制御する環境変数 |
| --- | --- | --- |
| `初回面接予定日` が「翌日」 | 翌日 | `REMIND_OFFSET_DAYS` |
| `面接設定可否` が `設定済み` | 有効 | `INTERVIEW_SCHEDULED_VALUES` |
| `リマインド可否` が `実施` / `可` / `TRUE` | 有効 | `REMIND_FLAG_MODE` |
| `メールアドレス` が正しい形式 | 常に有効 | — |
| `担当者` に送信元アドレスが登録済み | 常に有効 | `OWNER_EMAIL_MAP` |
| 送信ログに未記録 | 常に有効 | `LOG_SHEET_TITLE` |

`リマインド可否` は**担当者が入力する「送ってよい」フラグ**として扱う (`requireMarked`)。
承認されていない行には送らない。この列はシステムからは書き換えない。

重複送信の防止は非表示シート `_reminder_log` が担保する。`sent` として記録された行だけが
重複判定に使われるため、送信に失敗した分は翌日に再送される。

### 差出人は担当者ごと

`担当者` 列の値を `OWNER_EMAIL_MAP` で引き、**その担当者本人の Gmail から送信する**
（`From: 新田（株式会社Quad） <nitta@quad-4.co.jp>`）。返信は担当者本人に届き、
送信済みメールも本人の送信済みトレイに残る。

`OWNER_EMAIL_MAP` に無い担当者の行は、**送信せずに実行を失敗扱い**にする。
誰か別の人の名前で送るくらいなら送らない、という判断。ログに担当者名が出るので追加すればよい。
`FALLBACK_TO_DEFAULT_SENDER=true` にすると `DEFAULT_SENDER_ADDRESS` から送る挙動に変えられる。

### 列の対応付け

列は**位置ではなくヘッダー文字列**で解決する。列を差し込んでも並べ替えても壊れない。
ヘッダーは各シートの先頭 10 行から自動検出するため、KPI シートなど該当列を持たない
シートは自動的に無視される (`skipped: no-header`)。

| 内部名 | 受け付けるヘッダー | 必須 |
| --- | --- | --- |
| `candidateName` | 求職者名 / 氏名 / 名前 | ✅ |
| `email` | メールアドレス / メール / Email | ✅ |
| `interviewAt` | 初回面接予定日 / 面接予定日 / 面接日 | ✅ |
| `owner` | 担当者 | |
| `interviewScheduled` | 面接設定可否 | |
| `remindFlag` | リマインド可否 / リマインド | |
| `company` | 求人掲載企業 / 企業名 | |
| `jobTitle` | 応募職種 / 職種 | |

### 日付の解釈

`初回面接予定日` は次をすべて受け付ける。解釈できない値は **送らない** 側に倒す。

- `2026/07/28 0:00:00` / `2026-07-28` / `2026年7月28日`
- `5/13` — 年なしは前年・今年・翌年のうち今日に最も近い年に解決する
- Sheets のシリアル値 (`46231`)
- `未定`, `調整中`, 空欄 → 送信対象外

タイムゾーンは JST 固定。GitHub Actions の UTC ランナー上でも「翌日」は JST の暦日で判定する。

---

## セットアップ

担当者ごとの差出人で送るため、**サービスアカウント + Workspace のドメイン全体の委任 (DWD)** を使う。
ブラウザでの OAuth 同意は不要だが、**Workspace 管理者の操作が1回だけ必要**。

### 1. サービスアカウントを作る

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIs & Services → Library** で **Google Sheets API** と **Gmail API** を有効化
3. **IAM & Admin → Service Accounts → Create service account**
   - 名前は `indeed-reminder` など
4. 作成したサービスアカウント → **Keys → Add key → Create new key → JSON**
   → ダウンロードした JSON を控える
5. 同じ画面の **Details** タブで **Unique ID (クライアント ID)** を控える（数字の羅列）

### 2. ドメイン全体の委任を承認する（Workspace 管理者）

[Google Admin コンソール](https://admin.google.com/) → **セキュリティ → アクセスとデータ管理
→ API の制御 → ドメイン全体の委任 → 新しく追加**

| 項目 | 値 |
| --- | --- |
| クライアント ID | 手順 1-5 の Unique ID |
| OAuth スコープ | `https://www.googleapis.com/auth/gmail.send` |

これで、このサービスアカウントは quad-4.co.jp のユーザーとしてメールを**送信のみ**できる。
受信メールを読む権限は付与されない。

### 3. スプレッドシートを共有する

サービスアカウントのアドレス（`...@....iam.gserviceaccount.com`）に、
対象スプレッドシートの**編集権限**を付与する（`_reminder_log` シートの作成に必要）。

> スプレッドシートの所有者は daichi@quad-4.co.jp です。共有権限が無い場合は依頼してください。

### 4. ローカルで DRY RUN

```bash
npm install
cp .env.example .env   # 値を埋める。DRY_RUN=true のまま
set -a && . ./.env && set +a
npm run dry-run
```

送信せずに、差出人・宛先・件名・本文と、行ごとのスキップ理由が JSON ログで出る。
`considered` と各行の `from` が意図どおりか必ず確認する。

### 5. GitHub Actions に登録する

**Settings → Secrets and variables → Actions**

Secrets:

| 名前 | 値 |
| --- | --- |
| `SPREADSHEET_ID` | `1J312hSawdBlyyFfQYEWkK7siatN2f7zulwkWBKz1fhI` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | 手順 1-4 の JSON 全文 |
| `OWNER_EMAIL_MAP` | `新田:nitta@quad-4.co.jp,針山:hariyama@quad-4.co.jp,大津:otsu@quad-4.co.jp` |

Variables (任意):

| 名前 | 例 |
| --- | --- |
| `TARGET_SHEET_IDS` | `1972955214` |
| `SENDER_NAME_SUFFIX` | `株式会社Quad` |
| `BCC_ADDRESSES` | `ops@quad-4.co.jp` |
| `REMIND_OFFSET_DAYS` | `1` |
| `MAX_SENDS_PER_RUN` | `50` |

登録後、**Actions → Daily reminder mail → Run workflow** を
`dry_run: true` のまま実行して結果を確認する。問題なければ以後は毎日自動で本送信される。

### 代替: OAuth モード（DWD が使えない場合）

`GOOGLE_SERVICE_ACCOUNT_KEY` の代わりに `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`GOOGLE_REFRESH_TOKEN` を設定すると、OAuth クライアント (Desktop app) でも動く。
トークンは `GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run authorize` で取得する。

ただし**この方式では全メールが認証した1アカウントから送られる**。
担当者ごとの差出人にはできないため、複数の担当者を `OWNER_EMAIL_MAP` に入れた状態では
起動時に設定エラーで停止する（間違った差出人で送るのを防ぐため）。

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
- **未登録の担当者は送信をブロックする。** 他人名義での送信を防ぐ。実行は失敗扱い (exit 1) になり、
  ログに担当者名が出る。
- **`MAX_SENDS_PER_RUN` (既定 50)** を超えると、1通も送らずに実行全体を中止する。
  列の対応付けが壊れて全行が対象化した場合の歯止め。
- **`リマインド可否` は書き換えない。** 担当者の入力列を勝手に上書きしない。
- **ヘッダーインジェクション対策。** シートの値に改行が混ざっていても、件名・宛先の改行は
  除去され、追加ヘッダーにはならない（テスト済み）。
- **メールアドレスの検証。** 表示名付き・カンマ区切り・空白入りは受理しない。1 セル = 1 宛先。
- **送信失敗は次回再送される。** ログに `sent` で記録された行だけが重複判定に使われる。
- **スコープは最小。** `spreadsheets` と `gmail.send` のみ。受信メールは読めない。

---

## 開発

```bash
npm test        # 型チェック + ユニットテスト (55 件、ネットワーク不要)
npm run typecheck
npm run dry-run
```

`src/domain/` は Google API に一切依存しない純粋ロジック
（日付解釈・列解決・送信対象選定・差出人解決・文面生成）。
`src/google/` が Sheets / Gmail のアダプタで、`src/ports.ts` のインターフェース経由で
`src/usecase/send-reminders.ts` に注入される。テストはすべてインメモリの差し替えで動く。

---

## 未確認事項

元の `リマインドメール.gs` はコンテナバインド型で Drive API から読み出せず、
送信済みメールも別アカウント配下のため、**既存の文面は再現できていない**。
`templates/` の文面は新規に起こしたもの。本送信の前に必ず確認すること。
