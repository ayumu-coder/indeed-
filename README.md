# indeed-reminder — 面接リマインドメール日次自動送信

`リマインドメール.gs` (Google Apps Script) の置き換え。
スプレッドシート「Quad求職者管理」を読み、**翌日に面接が入っている求職者へ、担当者本人のアドレスから**
リマインドメールを毎日自動送信する。

GitHub Actions の cron で毎日 19:00 JST に実行（旧 `.gs` のトリガーと同じ時刻）。
判定ロジックは純粋関数に分離してあり、`npm test` で1通も送らずに検証できる。

---

## 動作仕様

毎日 19:00 JST に全シートを走査し、**すべての条件を満たす行にだけ**送信する。

| 条件 | 既定値 | 制御する環境変数 |
| --- | --- | --- |
| `初回面接予定日` が「翌日」 | 翌日 | `REMIND_OFFSET_DAYS` |
| `面接設定可否` が `設定済み` | 有効 | `INTERVIEW_SCHEDULED_VALUES` |
| `リマインド可否` が `実施` / `可` / `TRUE` | 有効 | `REMIND_FLAG_MODE` |
| `面接詳細` が `送信済` で始まらない | 有効 | `SENT_MARKER_PREFIX` |
| `メールアドレス` が正しい形式 | 常に有効 | — |
| `担当者` に送信元アドレスが登録済み | 常に有効 | `OWNER_EMAIL_MAP` |
| From が確認済みエイリアス | 有効 | `VERIFY_SEND_AS_ALIASES` |
| 送信ログに未記録 | 常に有効 | `LOG_SHEET_TITLE` |

`リマインド可否` は**担当者が入力する「送ってよい」フラグ**として扱う (`requireMarked`)。
承認されていない行には送らない。この列はシステムからは書き換えない。

重複送信の防止は**二重**にかかる。非表示シート `_reminder_log`（`sent` として記録された行だけが
重複判定に使われるため、送信に失敗した分は翌日に再送される）と、旧 `.gs` 互換の
`面接詳細` 先頭の `送信済` マーカーの両方。後者があるため、**旧スクリプトが既に送った行へ
移行直後に再送することはない**。

### 差出人は担当者ごと

`担当者` 列の値を `OWNER_EMAIL_MAP` で引き、**その担当者のアドレスから送信する**。
旧 `.gs` と同じく **Gmail の「他のメールアドレスを追加」（Send-As エイリアス）**方式で、
認証したアカウントに確認済みエイリアスとして登録されている必要がある。

> 担当者のアドレスは `@gmail.com`（コンシューマー アカウント）のため、
> **Workspace のドメイン全体の委任は使えない。**ドメイン外のユーザーは代理できないため。

`OWNER_EMAIL_MAP` に無い担当者の行は、**送信せずに実行を失敗扱い**にする。
誰か別の人の名前で送るくらいなら送らない、という判断。ログに担当者名が出るので追加すればよい。
`FALLBACK_TO_DEFAULT_SENDER=true` にすると `DEFAULT_SENDER_ADDRESS` から送る挙動に変えられる。

同様に、**確認済みエイリアスでない From も送信をブロックし、実行を失敗扱いにする**。
旧 `.gs` はここを無言でスキップしていた（後述）。

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
| `interviewDetail` | 面接詳細 | |
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

旧 `.gs` と同じ Send-As エイリアス方式のため、**Workspace 管理者の作業は不要**。

### 1. Gmail エイリアスを確認する

`OWNER_EMAIL_MAP` の全アドレスが、これから認証するアカウントの
**設定 → アカウントとインポート → 他のメールアドレスを追加** に
「確認済み」として登録されていること。

旧 `.gs` のトリガーを作成したアカウントで登録済みのはずなので、
**同じアカウントで手順 2 を実行する**こと。

### 2. OAuth クライアントとリフレッシュトークン

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIs & Services → Library** で **Google Sheets API** と **Gmail API** を有効化
3. **Credentials → Create Credentials → OAuth client ID → Desktop app**
4. **OAuth consent screen** で、手順 1 のアカウントを Test user に追加
5. ローカルで実行し、**手順 1 のアカウント**で許可する:

```bash
npm install
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run authorize
```

`GOOGLE_REFRESH_TOKEN=1//...` が出力される。要求スコープは3つ:

- `spreadsheets` — シートの読み書き
- `gmail.send` — 送信のみ
- `gmail.settings.basic` — エイリアス一覧の読み取り（送信前の検査用。本文は読まない）

### 3. スプレッドシートを共有する

手順 2 で認証したアカウントに、対象スプレッドシートの**編集権限**を付与する
（`_reminder_log` シートの作成と `面接詳細` へのマーカー追記に必要）。

> 所有者は daichi@quad-4.co.jp です。権限が無い場合は依頼してください。

### 4. ローカルで DRY RUN

```bash
cp .env.example .env   # 値を埋める。DRY_RUN=true のまま
set -a && . ./.env && set +a
npm run dry-run
```

差出人・宛先・件名・本文と、行ごとのスキップ理由が JSON ログで出る。
`considered` と各行の `from` が意図どおりか必ず確認する。

### 5. GitHub Actions に登録する

**Settings → Secrets and variables → Actions**

Secrets:

| 名前 | 値 |
| --- | --- |
| `SPREADSHEET_ID` | `1J312hSawdBlyyFfQYEWkK7siatN2f7zulwkWBKz1fhI` |
| `OWNER_EMAIL_MAP` | `新田:sakaguchi.saiyou@gmail.com,大津:bangtangsaiyo695@gmail.com,針山:seiyaquad202510@gmail.com` |
| `GOOGLE_CLIENT_ID` | 手順 2 |
| `GOOGLE_CLIENT_SECRET` | 手順 2 |
| `GOOGLE_REFRESH_TOKEN` | 手順 2 |

Variables (任意):

| 名前 | 例 |
| --- | --- |
| `TARGET_SHEET_IDS` | `1972955214` |
| `REMIND_OFFSET_DAYS` | `1` |
| `BCC_ADDRESSES` | `ops@quad-4.co.jp` |
| `MAX_SENDS_PER_RUN` | `50` |

登録後、**Actions → Daily reminder mail → Run workflow** を
`dry_run: true` のまま実行して確認する。問題なければ以後は毎日 19:00 JST に自動送信。

### 旧 `.gs` の停止

本番送信に切り替えたら、Apps Script 側のトリガーを削除すること
（**Apps Script エディタ → トリガー → 削除**）。両方動くと二重送信になる。

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

## 旧 `.gs` から修正した点

**1. エイリアス未登録時の無言スキップ**

```js
if (allowedFrom.indexOf(from) === -1) { skipped.noSender++; continue; }
```

実行アカウントにエイリアスが登録されていないと、全行がここで除外され、
**エラーも出ず 0 件で正常終了**していた。「動かないのに何も起きない」症状の原因はこれ。
本実装では該当アドレスをログに出し、実行を失敗扱い (exit 1) にする。

**2. 本文に「00:00」と表示される**

```js
hasTime: row[C.DATE - 1] instanceof Date,
```

L列は `2026/07/28 0:00:00` = Date 型なので `hasTime` が常に true になり、
「2026年7月28日(火) 00:00」と表示されていた。本実装は時刻が 0:00 のとき日付のみを出す。

**3. 二重送信防止マーカーの置き場所**

マーカーを `面接詳細`（担当者が編集する内容列）に置いていたため、メモの整理で
マーカーが消えると再送されうる。本実装は非表示シート `_reminder_log` を正とし、
`面接詳細` のマーカーは互換性のための補助（既存内容は保持して先頭に追記）に格下げした。
`WRITE_SENT_MARKER=false` で追記を止められる。

**4. 一括読み込みと言いつつ行ごとに `setValue()`**

コメントに反して `targets.forEach` 内で1セルずつ書き込んでいた。
本実装は `batchUpdate` で1回にまとめる。

**5. 追加した安全策**

- `面接設定可否` が `設定済み` の行のみ対象（実データでは差分 0 件。将来の事故防止）
- `MAX_SENDS_PER_RUN` 超過時は1通も送らず中止
- 件名・宛先のヘッダーインジェクション遮断
- メールアドレス形式の検証
