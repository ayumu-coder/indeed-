/** 投稿パイプラインのポート定義。実装（S3 / Instagram）はこの型にだけ依存する。 */

export interface StoredObject {
  readonly key: string;
  /** 期限付きの公開 URL。外部サービスがこの URL から動画を取得する。 */
  readonly url: string;
  readonly expiresAt: Date;
}

export interface ObjectStorage {
  readonly name: string;
  /** ローカルファイルを置き、期限付き取得 URL を返す。 */
  put(localPath: string, key: string, contentType: string): Promise<StoredObject>;
}

export interface ReelUpload {
  readonly videoUrl: string;
  readonly caption: string;
  /** リールをフィードにも表示するか。 */
  readonly shareToFeed: boolean;
}

export interface PublishResult {
  readonly mediaId: string;
  readonly containerId: string;
}

export interface QuotaStatus {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}

export interface ReelsPublisher {
  readonly name: string;
  /** 直近 24 時間の投稿枠。上限は実測値を問い合わせる（配信面ごとに異なり変更もされるため）。 */
  quota(): Promise<QuotaStatus>;
  publish(upload: ReelUpload): Promise<PublishResult>;
}

/** ネットワーク呼び出しを差し替えられるようにするための最小インターフェース。 */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;
