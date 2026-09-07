import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  instagramConfigFromEnv,
  isDryRun,
  MissingConfigError,
  shareToFeedFromEnv,
  storageConfigFromEnv,
} from '../src/publish/config.ts';

const KEYS = [
  'S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'S3_PATH_STYLE', 'MEDIA_URL_TTL_SECONDS', 'IG_USER_ID', 'IG_ACCESS_TOKEN',
  'IG_GRAPH_VERSION', 'IG_POLL_INTERVAL_MS', 'IG_POLL_TIMEOUT_MS', 'IG_SHARE_TO_FEED', 'DRY_RUN',
] as const;

function withEnv(values: Readonly<Record<string, string>>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const key of KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, values);
  try {
    run();
  } finally {
    for (const key of KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const STORAGE = {
  S3_ENDPOINT: 'https://abc.r2.cloudflarestorage.com',
  S3_BUCKET: 'shorts',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

test('不足している環境変数をすべて挙げて落とす', () => {
  withEnv({ S3_BUCKET: 'shorts' }, () => {
    assert.throws(() => storageConfigFromEnv(), (error: unknown) => {
      assert.ok(error instanceof MissingConfigError);
      assert.deepEqual(error.missing, ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
      return true;
    });
  });
});

test('R2 向けの既定値（region=auto / パススタイル）', () => {
  withEnv(STORAGE, () => {
    const config = storageConfigFromEnv();
    assert.equal(config.region, 'auto');
    assert.equal(config.pathStyle, true);
    assert.equal(config.urlTtlSeconds, 3600);
  });
});

test('S3_PATH_STYLE=false で仮想ホスト形式になる', () => {
  withEnv({ ...STORAGE, S3_PATH_STYLE: 'false', S3_REGION: 'ap-northeast-1' }, () => {
    const config = storageConfigFromEnv();
    assert.equal(config.pathStyle, false);
    assert.equal(config.region, 'ap-northeast-1');
  });
});

test('Graph API のバージョンは既定で固定される', () => {
  withEnv({ IG_USER_ID: '178', IG_ACCESS_TOKEN: 't' }, () => {
    const config = instagramConfigFromEnv();
    assert.match(config.graphVersion, /^v\d+\.\d+$/);
    assert.equal(config.pollIntervalMs, 5000);
    assert.equal(config.pollTimeoutMs, 300_000);
  });
});

test('送信は明示的なオプトイン。既定はドライラン', () => {
  withEnv({}, () => assert.equal(isDryRun(), true));
  withEnv({ DRY_RUN: 'true' }, () => assert.equal(isDryRun(), true));
  // 空文字や誤記で誤って本番送信しないこと。
  withEnv({ DRY_RUN: '' }, () => assert.equal(isDryRun(), true));
  withEnv({ DRY_RUN: 'no' }, () => assert.equal(isDryRun(), true));
  withEnv({ DRY_RUN: 'false' }, () => assert.equal(isDryRun(), false));
});

test('フィード表示は既定で有効', () => {
  withEnv({}, () => assert.equal(shareToFeedFromEnv(), true));
  withEnv({ IG_SHARE_TO_FEED: 'false' }, () => assert.equal(shareToFeedFromEnv(), false));
});
