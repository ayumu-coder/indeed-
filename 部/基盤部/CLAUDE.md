# 基盤部

担当: hr-platform・ユーザー登録とログイン確認 (Windows PC 上)、LINE自動応答くん (session_01MWBCXuxUciuJANbsmG4zxF、クラウド、ブランチ `claude/auto-forward-email-line-16l2qv`)。hr-platform アプリ・公開 URL・Windows 常駐化・LINE 自動応答 (GAS)。

## 目次

- [ルール](#ルール)
- [持ち物](#持ち物)
- [現状](#現状)

## ルール

- 常駐化 (Task Scheduler + powercfg) はユーザー承認済み (9/28「常駐化 OK」)。導入は Windows PC 上でユーザーが行う。
- 認証情報・ログイン情報はメッセージに書かず、Windows PC のターミナル内に留める。
- LINE 自動応答は承認モードから開始する。第 1 歩 (受信ログ) が動くまで公式アカウントからグループへ送信しない。社内グループ (全体連絡用) は取引先台帳に区分=社内で登録し返信しない。

## 持ち物

- hr-platform (Windows PC 上のアプリ、trycloudflare の公開 URL。クイックトンネルは再起動で URL が変わる)。
- Windows 常駐化一式 (keepalive.ps1 / setup-power.ps1 / install-tasks.ps1 / uninstall-tasks.ps1 / README_常駐化手順_Windows.md) は 9/29 に部長がユーザーへ納品済み。repo には未収録。macOS 用 launchd 一式 (9/28 納品) は誤りだったため廃棄。
- LINE 自動応答 (デフォルトブランチ `claude/auto-forward-email-line-16l2qv` の `line-autoreply/`、GAS ウェブアプリ + 会話ログ、commit cf31bb5〜496b6dd)。秘密情報 (チャネルシークレット・アクセストークン・WEBHOOK_TOKEN・ウェブアプリ URL) はスクリプトプロパティのみに置き、チャット・シート・repo に書かない。

## 現状

- PC のスリープでセッションと公開 URL が落ちる (9/28 に 1033 エラー)。常駐化は未導入 (導入はユーザーが Windows 上で行う)。
- ユーザー登録とログイン確認: ログイン試行待ち (ユーザー対応中)。
- LINE 自動応答: コードは第 3 歩まで commit 済み (9/30、第 2 歩 6757b1c・第 3 歩 496b6dd)。デプロイは 9/29 時点の記録 (第 1 歩、B-3 Code.gs 貼り付けまで完了、LINE Developers ログインと Google 承認 A-1〜A-10・B-4〜B-14 はユーザー作業待ち) 以降、未報告。管理シート「LINE自動応答_管理」、報告シート「部長報告_LINE自動応答_20260929」。
