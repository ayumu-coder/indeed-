import { numberFromEnv, stringFromEnv } from '../env.ts';
import type { InstagramConfig } from './instagram.ts';
import type { S3StorageConfig } from './s3-storage.ts';

export class MissingConfigError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`環境変数が不足しています:\n- ${missing.join('\n- ')}`);
    this.name = 'MissingConfigError';
    this.missing = missing;
  }
}

function required(keys: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of keys) {
    const value = stringFromEnv(key);
    if (value === null) missing.push(key);
    else values[key] = value;
  }
  if (missing.length > 0) throw new MissingConfigError(missing);
  return values;
}

export function storageConfigFromEnv(): S3StorageConfig {
  const values = required(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
  return {
    endpoint: values['S3_ENDPOINT'] ?? '',
    bucket: values['S3_BUCKET'] ?? '',
    // R2 はリージョンを持たないため `auto` を既定にする。
    region: stringFromEnv('S3_REGION') ?? 'auto',
    credentials: {
      accessKeyId: values['S3_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: values['S3_SECRET_ACCESS_KEY'] ?? '',
    },
    urlTtlSeconds: numberFromEnv('MEDIA_URL_TTL_SECONDS', 3600),
    // 仮想ホスト形式に対応しない S3 互換ストレージがあるため既定はパススタイル。
    pathStyle: (stringFromEnv('S3_PATH_STYLE') ?? 'true') !== 'false',
  };
}

export function instagramConfigFromEnv(): InstagramConfig {
  const values = required(['IG_USER_ID', 'IG_ACCESS_TOKEN']);
  return {
    igUserId: values['IG_USER_ID'] ?? '',
    accessToken: values['IG_ACCESS_TOKEN'] ?? '',
    // Graph API はバージョンごとに破壊的変更が入る。既定は固定し、更新は明示的に行う。
    graphVersion: stringFromEnv('IG_GRAPH_VERSION') ?? 'v24.0',
    pollIntervalMs: numberFromEnv('IG_POLL_INTERVAL_MS', 5000),
    pollTimeoutMs: numberFromEnv('IG_POLL_TIMEOUT_MS', 300_000),
  };
}

export function shareToFeedFromEnv(): boolean {
  return (stringFromEnv('IG_SHARE_TO_FEED') ?? 'true') !== 'false';
}

/** 送信は明示的なオプトイン。既定はドライラン（リポジトリ全体の方針に合わせる）。 */
export function isDryRun(): boolean {
  return (stringFromEnv('DRY_RUN') ?? 'true') !== 'false';
}
