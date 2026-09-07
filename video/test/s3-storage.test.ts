import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createS3Storage, type S3StorageConfig } from '../src/publish/s3-storage.ts';
import { buildObjectKey } from '../src/publish/object-key.ts';
import type { FetchLike } from '../src/publish/ports.ts';

const BASE: S3StorageConfig = {
  endpoint: 'https://abcdef.r2.cloudflarestorage.com',
  bucket: 'shorts',
  region: 'auto',
  credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
  urlTtlSeconds: 900,
  pathStyle: true,
};
const NOW = new Date('2026-09-07T06:52:18Z');

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 's3-test-'));
  const path = join(dir, 'clip.mp4');
  await writeFile(path, Buffer.from('hello short video'));
  return path;
}

function recorder(status = 200): { fetch: FetchLike; seen: { url: string; headers: Record<string, string> }[] } {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, headers: { ...(init?.headers ?? {}) } });
    return { ok: status < 400, status, text: async () => 'AccessDenied' };
  };
  return { fetch, seen };
}

test('パススタイルでは /bucket/key へ PUT する', async () => {
  const { fetch, seen } = recorder();
  const storage = createS3Storage(BASE, { fetch, now: () => NOW });
  const stored = await storage.put(await fixture(), 'shorts/2026-09-07/s01.mp4', 'video/mp4');

  assert.equal(seen[0]?.url, 'https://abcdef.r2.cloudflarestorage.com/shorts/shorts/2026-09-07/s01.mp4');
  assert.equal(seen[0]?.headers['content-type'], 'video/mp4');
  assert.equal(seen[0]?.headers['content-length'], '17');
  assert.match(seen[0]?.headers['Authorization'] ?? '', /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/);
  assert.equal(stored.key, 'shorts/2026-09-07/s01.mp4');
  assert.equal(stored.expiresAt.toISOString(), '2026-09-07T07:07:18.000Z');
});

test('仮想ホスト形式ではバケットがホスト名に入る', async () => {
  const { fetch, seen } = recorder();
  const storage = createS3Storage(
    { ...BASE, endpoint: 'https://s3.ap-northeast-1.amazonaws.com', region: 'ap-northeast-1', pathStyle: false },
    { fetch, now: () => NOW },
  );
  await storage.put(await fixture(), 'a/b.mp4', 'video/mp4');
  assert.equal(seen[0]?.url, 'https://shorts.s3.ap-northeast-1.amazonaws.com/a/b.mp4');
});

test('プリサイン URL に有効期限と署名が入る', async () => {
  const { fetch } = recorder();
  const storage = createS3Storage(BASE, { fetch, now: () => NOW });
  const stored = await storage.put(await fixture(), 'a/b.mp4', 'video/mp4');
  const url = new URL(stored.url);

  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
  // 署名鍵そのものが URL に出てはいけない。
  assert.ok(!stored.url.includes('wJalrXUtnFEMI'));
});

test('アップロード失敗は本文付きで落とす', async () => {
  const { fetch } = recorder(403);
  const storage = createS3Storage(BASE, { fetch, now: () => NOW });
  const path = await fixture();
  await assert.rejects(() => storage.put(path, 'a/b.mp4', 'video/mp4'), /403.*AccessDenied/s);
});

test('保存キーは内容が同じなら同じ、変われば変わる', () => {
  const at = new Date('2026-09-07T00:00:00Z');
  const key = buildObjectKey('s01', Buffer.from('same'), at);
  assert.equal(key, buildObjectKey('s01', Buffer.from('same'), at));
  assert.notEqual(key, buildObjectKey('s01', Buffer.from('different'), at));
  assert.match(key, /^shorts\/2026-09-07\/s01-[0-9a-f]{8}\.mp4$/);
});
