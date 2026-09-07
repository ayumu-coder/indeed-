import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInstagramPublisher, exchangeLongLivedToken, GraphApiError, type InstagramDeps } from '../src/publish/instagram.ts';
import type { FetchLike } from '../src/publish/ports.ts';

const CONFIG = {
  igUserId: '17841400000000000',
  accessToken: 'SECRET_TOKEN',
  graphVersion: 'v24.0',
  pollIntervalMs: 10,
  pollTimeoutMs: 100,
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

function stubFetch(responses: readonly (object | { __status: number; body: object })[]): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
    const entry = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const isError = entry !== undefined && '__status' in entry;
    const status = isError ? (entry as { __status: number }).__status : 200;
    const payload = isError ? (entry as { body: object }).body : entry;
    return { ok: status < 400, status, text: async () => JSON.stringify(payload) };
  };
  return { fetch, calls };
}

function deps(fetch: FetchLike, clock: { value: number } = { value: 0 }): InstagramDeps {
  return {
    fetch,
    sleep: async (ms) => {
      clock.value += ms;
    },
    now: () => clock.value,
  };
}

test('コンテナ作成 → 完了待ち → 公開 の順で呼ぶ', async () => {
  const { fetch, calls } = stubFetch([
    { id: 'CONTAINER_1' },
    { status_code: 'IN_PROGRESS' },
    { status_code: 'FINISHED' },
    { id: 'MEDIA_1' },
  ]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  const result = await publisher.publish({ videoUrl: 'https://x/v.mp4', caption: 'テスト', shareToFeed: true });

  assert.deepEqual(result, { containerId: 'CONTAINER_1', mediaId: 'MEDIA_1' });
  assert.equal(calls.length, 4);
  assert.match(calls[0]?.url ?? '', /\/v24\.0\/17841400000000000\/media$/);
  assert.equal(calls[0]?.method, 'POST');
  assert.match(calls[0]?.body ?? '', /media_type=REELS/);
  assert.match(calls[0]?.body ?? '', /share_to_feed=true/);
  assert.match(calls[3]?.body ?? '', /creation_id=CONTAINER_1/);
});

test('アクセストークンを URL に載せない', async () => {
  const { fetch, calls } = stubFetch([{ id: 'C' }, { status_code: 'FINISHED' }, { id: 'M' }]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  await publisher.publish({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: false });

  const posts = calls.filter((call) => call.method === 'POST');
  assert.ok(posts.length >= 2);
  for (const call of posts) {
    assert.ok(!call.url.includes('SECRET_TOKEN'), call.url);
    assert.ok(call.body.includes('access_token=SECRET_TOKEN'));
  }
});

test('コンテナが ERROR になったら即座に失敗する', async () => {
  const { fetch } = stubFetch([{ id: 'C' }, { status_code: 'ERROR', status: 'Video format not supported' }]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  await assert.rejects(
    () => publisher.publish({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true }),
    /Video format not supported/,
  );
});

test('処理が終わらない場合はタイムアウトする', async () => {
  const { fetch } = stubFetch([{ id: 'C' }, { status_code: 'IN_PROGRESS' }]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  await assert.rejects(
    () => publisher.publish({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true }),
    /100ms 以内に完了しませんでした/,
  );
});

test('Graph API のエラーは code 付きで投げる', async () => {
  const { fetch } = stubFetch([
    { __status: 400, body: { error: { message: 'Application request limit reached', code: 4, error_subcode: 2207051 } } },
  ]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  await assert.rejects(
    () => publisher.publish({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true }),
    (error: unknown) => {
      assert.ok(error instanceof GraphApiError);
      assert.equal(error.code, 4);
      assert.equal(error.subcode, 2207051);
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test('エラーメッセージからアクセストークンを伏せる', async () => {
  const { fetch } = stubFetch([
    { __status: 400, body: { error: { message: 'Invalid token SECRET_TOKEN supplied', code: 190 } } },
  ]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  await assert.rejects(
    () => publisher.publish({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true }),
    (error: unknown) => {
      assert.ok(error instanceof GraphApiError);
      assert.ok(!error.message.includes('SECRET_TOKEN'), error.message);
      assert.match(error.message, /\*\*\*/);
      return true;
    },
  );
});

test('投稿枠は応答の実測値から算出する', async () => {
  const { fetch, calls } = stubFetch([{ data: [{ config: { quota_total: 25, quota_duration: 86400 }, quota_usage: 22 }] }]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  assert.deepEqual(await publisher.quota(), { used: 22, limit: 25, remaining: 3 });
  assert.match(calls[0]?.url ?? '', /content_publishing_limit\?fields=config%2Cquota_usage/);
});

test('使用量が上限を超えても残りは負にならない', async () => {
  const { fetch } = stubFetch([{ data: [{ config: { quota_total: 25 }, quota_usage: 30 }] }]);
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  assert.equal((await publisher.quota()).remaining, 0);
});

test('長期トークンへの交換', async () => {
  const { fetch, calls } = stubFetch([{ access_token: 'LONG_LIVED', token_type: 'bearer', expires_in: 5183944 }]);
  const token = await exchangeLongLivedToken(
    { appId: '1', appSecret: 's', shortLivedToken: 'short', graphVersion: 'v24.0' },
    { fetch },
  );
  assert.equal(token.accessToken, 'LONG_LIVED');
  assert.equal(token.expiresInSeconds, 5183944);
  assert.match(calls[0]?.url ?? '', /grant_type=fb_exchange_token/);
});

test('JSON でない応答も握りつぶさない', async () => {
  const fetch: FetchLike = async () => ({ ok: false, status: 502, text: async () => '<html>Bad Gateway</html>' });
  const publisher = createInstagramPublisher(CONFIG, deps(fetch));
  await assert.rejects(() => publisher.quota(), /JSON ではありません/);
});
