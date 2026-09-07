import type { FetchLike, PublishResult, QuotaStatus, ReelUpload, ReelsPublisher } from './ports.ts';

export interface InstagramConfig {
  /** Instagram プロアカウントのユーザー ID（Facebook ページに紐づくもの）。 */
  readonly igUserId: string;
  readonly accessToken: string;
  /** 例: `v24.0`。破壊的変更があるため必ず固定して使う。 */
  readonly graphVersion: string;
  readonly pollIntervalMs: number;
  readonly pollTimeoutMs: number;
}

export interface InstagramDeps {
  readonly fetch: FetchLike;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const defaultDeps: InstagramDeps = {
  fetch: globalThis.fetch as unknown as FetchLike,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

const GRAPH_HOST = 'https://graph.facebook.com';

/** 処理中を示すステータス。これ以外は成功か失敗で確定する。 */
const IN_PROGRESS = 'IN_PROGRESS';
const FINISHED = 'FINISHED';

export class GraphApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;

  constructor(message: string, status: number, code: number | null, subcode: number | null) {
    super(message);
    this.name = 'GraphApiError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

/** アクセストークンはログにも例外にも出さない。 */
function redact(text: string, token: string): string {
  return token.length === 0 ? text : text.split(token).join('***');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function parseGraphResponse(
  response: { ok: boolean; status: number; text(): Promise<string> },
  token: string,
): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GraphApiError(`Graph API の応答が JSON ではありません: ${redact(raw.slice(0, 300), token)}`,
      response.status, null, null);
  }
  if (!isRecord(parsed)) {
    throw new GraphApiError('Graph API の応答が不正です', response.status, null, null);
  }
  const error = parsed['error'];
  if (isRecord(error)) {
    const message = typeof error['message'] === 'string' ? error['message'] : '不明なエラー';
    const code = typeof error['code'] === 'number' ? error['code'] : null;
    const subcode = typeof error['error_subcode'] === 'number' ? error['error_subcode'] : null;
    throw new GraphApiError(redact(message, token), response.status, code, subcode);
  }
  if (!response.ok) {
    throw new GraphApiError(`Graph API が ${response.status} を返しました`, response.status, null, null);
  }
  return parsed;
}

export function createInstagramPublisher(
  config: InstagramConfig,
  deps: InstagramDeps = defaultDeps,
): ReelsPublisher {
  const base = `${GRAPH_HOST}/${config.graphVersion}`;

  const get = async (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
    const query = new URLSearchParams({ ...params, access_token: config.accessToken });
    const response = await deps.fetch(`${base}${path}?${query.toString()}`, { method: 'GET' });
    return await parseGraphResponse(response, config.accessToken);
  };

  const post = async (path: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
    // トークンはクエリではなくボディに載せる（URL はログや中間装置に残りやすい）。
    const body = new URLSearchParams({ ...params, access_token: config.accessToken });
    const response = await deps.fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return await parseGraphResponse(response, config.accessToken);
  };

  const readId = (payload: Record<string, unknown>, label: string): string => {
    const id = payload['id'];
    if (typeof id !== 'string' || id.length === 0) throw new Error(`${label} の ID を取得できませんでした`);
    return id;
  };

  /** コンテナの処理が終わるまで待つ。ERROR / EXPIRED は即座に失敗させる。 */
  const waitForContainer = async (containerId: string): Promise<void> => {
    const deadline = deps.now() + config.pollTimeoutMs;
    for (;;) {
      const payload = await get(`/${containerId}`, { fields: 'status_code,status' });
      const statusCode = payload['status_code'];
      if (statusCode === FINISHED) return;
      if (statusCode !== IN_PROGRESS) {
        const detail = typeof payload['status'] === 'string' ? payload['status'] : String(statusCode);
        throw new Error(`コンテナ ${containerId} の処理に失敗しました: ${detail}`);
      }
      if (deps.now() >= deadline) {
        throw new Error(`コンテナ ${containerId} が ${config.pollTimeoutMs}ms 以内に完了しませんでした`);
      }
      await deps.sleep(config.pollIntervalMs);
    }
  };

  return {
    name: `instagram(${config.igUserId}, ${config.graphVersion})`,

    async quota(): Promise<QuotaStatus> {
      const payload = await get(`/${config.igUserId}/content_publishing_limit`, {
        fields: 'config,quota_usage',
      });
      const entries = payload['data'];
      const first = Array.isArray(entries) ? entries[0] : undefined;
      if (!isRecord(first)) throw new Error('投稿枠の情報を取得できませんでした');

      const used = typeof first['quota_usage'] === 'number' ? first['quota_usage'] : 0;
      const configField = first['config'];
      // 上限は配信面側の都合で変わる。ハードコードせず応答の値を使う。
      const limit =
        isRecord(configField) && typeof configField['quota_total'] === 'number'
          ? configField['quota_total']
          : 0;
      return { used, limit, remaining: Math.max(limit - used, 0) };
    },

    async publish(upload: ReelUpload): Promise<PublishResult> {
      const container = await post(`/${config.igUserId}/media`, {
        media_type: 'REELS',
        video_url: upload.videoUrl,
        caption: upload.caption,
        share_to_feed: String(upload.shareToFeed),
      });
      const containerId = readId(container, 'コンテナ');

      await waitForContainer(containerId);

      const published = await post(`/${config.igUserId}/media_publish`, { creation_id: containerId });
      return { containerId, mediaId: readId(published, '公開済みメディア') };
    },
  };
}

export interface LongLivedToken {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
}

/**
 * 短期トークンを長期トークン（およそ 60 日）に交換する。
 * 期限が切れると投稿が止まるため、定期的に実行して保管先を更新すること。
 */
export async function exchangeLongLivedToken(
  input: { readonly appId: string; readonly appSecret: string; readonly shortLivedToken: string; readonly graphVersion: string },
  deps: Pick<InstagramDeps, 'fetch'> = defaultDeps,
): Promise<LongLivedToken> {
  const query = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: input.appId,
    client_secret: input.appSecret,
    fb_exchange_token: input.shortLivedToken,
  });
  const response = await deps.fetch(`${GRAPH_HOST}/${input.graphVersion}/oauth/access_token?${query.toString()}`, {
    method: 'GET',
  });
  const payload = await parseGraphResponse(response, input.shortLivedToken);
  const accessToken = payload['access_token'];
  if (typeof accessToken !== 'string') throw new Error('長期トークンを取得できませんでした');
  const expires = payload['expires_in'];
  return { accessToken, expiresInSeconds: typeof expires === 'number' ? expires : 0 };
}
