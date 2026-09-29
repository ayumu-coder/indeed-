# 基盤部

担当: hr-platform・ユーザー登録とログイン確認 (Mac 上)。hr-platform アプリ・公開 URL・Mac 常駐化。

## 目次

- [ルール](#ルール)
- [持ち物](#持ち物)
- [現状](#現状)

## ルール

- 常駐化 (launchd) はユーザー承認済み (9/28「常駐化 OK」)。導入は Mac 上でユーザーが行う。
- 認証情報・ログイン情報はメッセージに書かず、Mac のターミナル内に留める。

## 持ち物

- hr-platform (Mac 上のアプリ、trycloudflare の公開 URL。クイックトンネルは再起動で URL が変わる)。
- launchd 一式 (caffeinate / rc-suchi / rc-hrplatform / cloudflared の plist + rc-keepalive.sh + install.sh) は 9/28 に部長がユーザーへ納品済み。repo には未収録。

## 現状

- Mac のスリープでセッションと公開 URL が落ちる (9/28 に 1033 エラー)。常駐化は未導入。
- ユーザー登録とログイン確認: ログイン試行待ち (ユーザー対応中)。
