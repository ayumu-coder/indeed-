import { readFile } from 'node:fs/promises';
import { presign, sha256Hex, signWithHeaders, type SigV4Context, type SigV4Credentials } from './sigv4.ts';
import type { FetchLike, ObjectStorage, StoredObject } from './ports.ts';

export interface S3StorageConfig {
  /** 例: `https://s3.ap-northeast-1.amazonaws.com` / `https://<account>.r2.cloudflarestorage.com` */
  readonly endpoint: string;
  readonly bucket: string;
  /** R2 は `auto`。 */
  readonly region: string;
  readonly credentials: SigV4Credentials;
  /** プリサイン URL の有効期限（秒）。 */
  readonly urlTtlSeconds: number;
  /** true でパススタイル (`/bucket/key`)。R2 と MinIO は必須。 */
  readonly pathStyle: boolean;
}

export interface S3StorageDeps {
  readonly fetch: FetchLike;
  readonly now: () => Date;
}

const defaultDeps: S3StorageDeps = { fetch: globalThis.fetch as unknown as FetchLike, now: () => new Date() };

interface Target {
  readonly host: string;
  readonly path: string;
}

function resolveTarget(config: S3StorageConfig, key: string): Target {
  const endpoint = new URL(config.endpoint);
  return config.pathStyle
    ? { host: endpoint.host, path: `/${config.bucket}/${key}` }
    : { host: `${config.bucket}.${endpoint.host}`, path: `/${key}` };
}

/**
 * S3 互換ストレージ。AWS S3 と Cloudflare R2 の双方で使う。
 * バケットは公開しない。取得は期限付きのプリサイン URL 経由にする。
 */
export function createS3Storage(
  config: S3StorageConfig,
  deps: S3StorageDeps = defaultDeps,
): ObjectStorage {
  return {
    name: `s3(${config.bucket}@${new URL(config.endpoint).host})`,
    async put(localPath: string, key: string, contentType: string): Promise<StoredObject> {
      const body = await readFile(localPath);
      const target = resolveTarget(config, key);
      const signedAt = deps.now();
      const context: SigV4Context = {
        region: config.region,
        service: 's3',
        credentials: config.credentials,
        signedAt,
      };

      const headers = signWithHeaders(
        {
          method: 'PUT',
          host: target.host,
          path: target.path,
          query: {},
          headers: { 'content-type': contentType, 'content-length': String(body.byteLength) },
          payloadHash: sha256Hex(body),
        },
        context,
      );

      const response = await deps.fetch(`https://${target.host}${encodeURI(target.path)}`, {
        method: 'PUT',
        headers: { ...headers },
        body,
      });
      if (!response.ok) {
        throw new Error(`アップロードに失敗 (${response.status}): ${(await response.text()).slice(0, 500)}`);
      }

      return {
        key,
        url: presign(
          { method: 'GET', host: target.host, path: target.path, query: {} },
          context,
          config.urlTtlSeconds,
        ),
        expiresAt: new Date(signedAt.getTime() + config.urlTtlSeconds * 1000),
      };
    },
  };
}
