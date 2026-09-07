# ショート動画ジェネレーター（TikTok / Instagram リール）

金融・副業ジャンルの縦型ショート動画を、**台本 JSON から MP4 まで一気通貫で書き出す**パイプライン。
台本は `video/data/scripts.json` の 1 ファイルだけが真実で、動画・字幕・投稿キャプションはすべてそこから生成される。

```
npm run video:check                     # 台本の検証のみ（禁止表現・文字数・スキーマ）
npm run video:test                      # 動画サブシステムの型チェックとテスト
npm run video:render                    # 全 5 本を video/out へ書き出す
npm run video:render -- --only=s03-deduction
npm run video:render -- --fps=30 --crf=19 --out=dist/shorts
npm run video:publish:dry-run           # Instagram へ投げる内容の確認
```

## 出力

| ファイル | 用途 |
| --- | --- |
| `video/out/<id>.mp4` | 投稿用。1080×1920 / 30fps / H.264 High / yuv420p / AAC / faststart |
| `video/out/<id>.srt` | プラットフォーム側の字幕として読み込ませる用 |
| `video/out/<id>.txt` | 投稿欄にそのまま貼るキャプション＋ハッシュタグ＋免責 |

## 構成

```
video/
├── data/scripts.json   台本（唯一の入力）
├── src/
│   ├── types.ts        ドメイン型と既定値
│   ├── validate.ts     JSON → 検証済み台本。禁止表現と文字数もここで落とす
│   ├── caption.ts      ナレーション → 字幕チャンク（純粋関数）
│   ├── timeline.ts     台本＋尺 → タイムライン（純粋関数）
│   ├── srt.ts          タイムライン → SRT / ナレーションテキスト
│   ├── page.ts         1080×1920 の HTML を生成。`window.__seek(ms)` で決定論的に描画
│   ├── render.ts       Playwright でフレームを取り、ffmpeg へ流す
│   ├── ffmpeg.ts       H.264/AAC エンコード・音声ミックス・尺の取得
│   ├── fonts.ts        Noto Sans JP の取得とキャッシュ（失敗時は IPAGothic）
│   └── cli.ts          エントリポイント
└── test/               純粋関数のテスト（ブラウザも ffmpeg も要らない）
```

### なぜ CSS アニメーションを使わないか

スクリーンショットを 1 フレームずつ撮る方式では、CSS アニメーションの再生位置が
撮影タイミングに依存してしまう。すべての見た目を `__seek(timeMs)` から純粋に計算することで、
**同じ入力なら常に同じフレーム**が出る（再現性・差分確認・部分再レンダリングが可能）。

## 台本 JSON

```jsonc
{
  "id": "s03-deduction",              // ファイル名になる。[a-z0-9-]
  "hookType": "損失回避",              // 損失回避 / 逆張り / 具体的数字。アクセントカラーを決める
  "telopFirstFrame": "去年の年末調整、\n損してるかも",
  "script": { "hook": "…", "problem": "…", "solution": "…", "cta": "…" },
  "visual": { "kind": "bullets" | "donut" | "steps" | "bars", … },
  "disclaimer": "※…",                 // フック後から最後まで出しっぱなしにする
  "ctaLabel": "…",
  "hashtags": ["控除", "iDeCo"]
}
```

`**強調**` で囲んだ部分は字幕上でアクセントカラーになる。文字数にはカウントされない。

### 検証（`npm run video:check`）

- **禁止表現**: 「絶対」「必ず儲か」「確実に稼げ」「元本保証」「放置で稼げ」「ノーリスク」「100%」など。
  景表法・金商法（投資助言）・プラットフォーム審査のいずれかに触れる語を機械的に落とす。
- **文字数**: ナレーション合計 140〜180 文字。日本語の標準的な尺で 15〜30 秒に収まる範囲。
- **スキーマ**: 未知の `visual.kind`、id 重複、閉じていない `**` を検出する。

CI に組み込む場合は `npm run video:check` だけでよい（ブラウザ不要・1 秒未満）。

## ナレーション音声

音声を合成した場合、**実測の尺でタイムラインを組み直す**。字幕・アニメーション・動画尺は
すべて音声に追従するため、話速を変えるとその分だけ動画が伸び縮みする。
合成できない場合は無音の AAC トラックを載せる（音声トラックが無い MP4 を弾く配信面があるため）。

エンジンは `TTS_ENGINE` で選ぶ。既定は `auto`（VOICEVOX → Open JTalk → 無音 の順）。

### VOICEVOX（推奨）

品質が高く、キャラクターごとに規約の範囲で商用利用できる。

```bash
docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest
VOICEVOX_URL=http://127.0.0.1:50021 VOICEVOX_SPEAKER=3 VOICEVOX_SPEED=1.15 npm run video:render
```

| 環境変数 | 既定 | 内容 |
| --- | --- | --- |
| `VOICEVOX_URL` | — | ENGINE の URL。設定すると VOICEVOX が選ばれる |
| `VOICEVOX_SPEAKER` | `3` | 話者 ID |
| `VOICEVOX_SPEED` | `1.15` | 話速 |

**クレジット表記**が必要な話者が多い。投稿前に利用規約を確認すること。

### Open JTalk（オフライン・プレビュー用）

依存が軽く、CI やローカル確認向き。**音声の質と商用利用可否は音声ファイル次第**。
Ubuntu の `hts-voice-nitech-jp-atr503-m001` は multiverse（non-free）で、
商用配信に使ってよいとは限らない。本番投稿は VOICEVOX か商用 TTS に差し替えること。

```bash
apt-get install -y open-jtalk open-jtalk-mecab-naist-jdic hts-voice-nitech-jp-atr503-m001
TTS_ENGINE=openjtalk npm run video:render
```

| 環境変数 | 既定 | 内容 |
| --- | --- | --- |
| `OPENJTALK_BIN` | `open_jtalk` | 実行ファイル |
| `OPENJTALK_DIC` | 自動検出 | 辞書ディレクトリ |
| `OPENJTALK_VOICE` | 自動検出 | `.htsvoice` ファイル |
| `OPENJTALK_RATE` | `1.8` | 話速。ショートは 1.7〜1.9 が読みやすい |
| `OPENJTALK_ALPHA` | `0.5` | 声質 |
| `OPENJTALK_PITCH` | `0` | ピッチシフト |
| `OPENJTALK_VOLUME` | `3` | 音量 (dB) |

### BGM（任意）

```bash
BGM_PATH=assets/bgm.mp3 BGM_GAIN_DB=-22 npm run video:render
```

BGM は尺が足りなければループする。最終段で `loudnorm` を通し、およそ -14 LUFS に揃える。
素材のライセンスは利用者が担保すること（リポジトリには同梱しない）。

## 依存

`playwright` と `ffmpeg-static` は **`optionalDependencies`** に置いてある。
リマインド送信・LINE 転送のワークフローは `npm ci --omit=optional` で入れるため、
本番ジョブのインストール時間とネットワーク依存を増やさない。
同じ理由でルートの `tsconfig.json` は `video/` を含めない（`video/tsconfig.json` が担当する）。

- `playwright`（描画）: Chromium が必要。`npx playwright install chromium`
- `ffmpeg-static`（エンコード）: `FFMPEG_PATH` で任意のバイナリに差し替え可能
- フォント: 起動時に Noto Sans JP を `video/.cache/fonts` へ取得。取得できない環境では OS の日本語フォントで描画する

## 既知の制約

- 1 本 20 秒の書き出しに約 40 秒（585 フレーム分のスクリーンショット）。並列化はしていない。
- 動画は完全にコード生成で、実写・ストック映像の合成は範囲外。B ロールを重ねる場合は
  出力 MP4 を素材として編集ソフト側で合成する前提。
- `data/users` のような外部データは読まない。台本の数値（試算値など）の正しさは人間が担保すること。


---

# Instagram リールへの投稿

`npm run video:publish` で「書き出し済み MP4 をストレージへ上げる → 期限付き URL を
Instagram Graph API に渡す → 公開」までを行う。**送信は `DRY_RUN=false` のときだけ**で、
既定はドライラン（リポジトリ全体の方針に合わせている）。

```bash
npm run video:render                    # 先に MP4 と <id>.txt を作る
npm run video:publish:dry-run           # 何をどこへ上げるかの確認
DRY_RUN=false npm run video:publish -- --only=s03-deduction
```

キャプションは `video/out/<id>.txt` をそのまま使う。投稿前に手で直せる。

## 事前準備（人手でしかできない作業）

| # | 作業 | 場所 |
| --- | --- | --- |
| 1 | Instagram をプロアカウント（ビジネス or クリエイター）に切り替える | Instagram アプリ |
| 2 | Facebook ページを作り、Instagram と連携する | Facebook |
| 3 | Meta 開発者登録してアプリを作成する | developers.facebook.com |
| 4 | アプリに Instagram Graph API 製品を追加し、`instagram_business_content_publish` の審査を通す | 同上 |
| 5 | 長期アクセストークンを取得する（短期は 1 時間で切れる） | Graph API Explorer |
| 6 | Instagram ユーザー ID を控える（`me/accounts` から辿れる） | 同上 |
| 7 | R2 か S3 でバケットを作り、アクセスキーを発行する | Cloudflare / AWS |

取得した値を `.env`（ローカル）と GitHub Actions の Secrets（CI）に入れる。

## 設計

```
video/src/publish/
├── ports.ts          ObjectStorage / ReelsPublisher のインターフェース
├── sigv4.ts          AWS Signature Version 4（依存なしの自前実装）
├── s3-storage.ts     S3 互換ストレージ（AWS S3 / Cloudflare R2 / MinIO）
├── instagram.ts      Graph API: コンテナ作成 → 完了待ち → 公開
├── config.ts         環境変数 → 設定。不足はまとめて報告する
├── object-key.ts     保存キー（日付 + 内容ハッシュ）
└── publish-cli.ts    エントリポイント
```

- **バケットは公開しない。** 取得は期限付きのプリサイン URL 経由にする。
  署名は AWS SDK を足さずに `node:crypto` だけで実装し、**botocore の署名結果と
  一致することをゴールデンテストで固定**している（`video/test/sigv4.test.ts`）。
- **アクセストークンは URL に載せない。** POST はボディに入れ、例外メッセージからも伏せる。
  URL はログや中間装置に残りやすいため。
- **投稿枠の上限をハードコードしない。** `content_publishing_limit` で実測値を取ってから投稿する。
  上限は配信面側の都合で変わり、公開情報も 25 / 50 / 100 と食い違っている。
- ネットワークと時刻はすべて注入できる。テストは実際の通信をしない。

## 制約と注意

- **動画は公開 URL から取得される。** ローカルファイルを直接アップロードする API は無い。
  ストレージが必須なのはこのため。
- **長期トークンはおよそ 60 日で失効する。** `exchangeLongLivedToken()` で更新できるが、
  更新の実行と保管先の書き換えは運用側で回す必要がある。
- **TikTok は対象外。** Content Posting API は監査を通すまで投稿が `SELF_ONLY` に強制され、
  未監査クライアントは 24 時間あたり 5 ユーザーまで。個人チャンネル 1 本のために
  監査を通す価値が出るまでは手動投稿か、審査済みのスケジューラ SaaS を使う。
- **機械的な連投は BAN 要因。** cron で自動投稿する場合も時間を散らすこと。
  同梱のワークフローに定期実行を入れていないのはこのため。
