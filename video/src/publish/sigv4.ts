import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4。
 * S3 と S3 互換ストレージ（Cloudflare R2 など）の署名に使う。
 * SDK を足すと本番ジョブのインストールが重くなるため、必要な部分だけ実装している。
 */

export interface SigV4Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface SigV4Request {
  readonly method: string;
  readonly host: string;
  /** `/bucket/key` 形式。各セグメントは未エンコードで渡す。 */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  /** ペイロードの SHA-256 hex。S3 では `UNSIGNED-PAYLOAD` も使える。 */
  readonly payloadHash: string;
}

export interface SigV4Context {
  readonly region: string;
  readonly service: string;
  readonly credentials: SigV4Credentials;
  readonly signedAt: Date;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';

/** RFC 3986。encodeURIComponent が残す `!'()*` も明示的にエスケープする。 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** パス区切りは維持したまま各セグメントをエンコードする。 */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/');
}

export function sha256Hex(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** `20150830T123600Z` / `20150830` */
function amzDate(date: Date): { readonly full: string; readonly short: string } {
  const full = `${date.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  return { full, short: full.slice(0, 8) };
}

function canonicalQueryString(query: Readonly<Record<string, string>>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key] ?? '')}`)
    .join('&');
}

interface CanonicalHeaders {
  readonly canonical: string;
  readonly signed: string;
}

function canonicalHeaders(headers: Readonly<Record<string, string>>): CanonicalHeaders {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  };
}

function signingKey(context: SigV4Context, shortDate: string): Buffer {
  const dateKey = hmac(`AWS4${context.credentials.secretAccessKey}`, shortDate);
  const regionKey = hmac(dateKey, context.region);
  const serviceKey = hmac(regionKey, context.service);
  return hmac(serviceKey, 'aws4_request');
}

export interface SignatureParts {
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly signature: string;
  readonly signedHeaders: string;
  readonly credentialScope: string;
  readonly amzDate: string;
}

/** 署名計算の各段階を返す。テストで中間結果を検証できるように分けてある。 */
export function computeSignature(request: SigV4Request, context: SigV4Context): SignatureParts {
  const { full, short } = amzDate(context.signedAt);
  const headers = canonicalHeaders(request.headers);
  const canonicalRequest = [
    request.method.toUpperCase(),
    encodePath(request.path),
    canonicalQueryString(request.query),
    headers.canonical,
    headers.signed,
    request.payloadHash,
  ].join('\n');

  const credentialScope = `${short}/${context.region}/${context.service}/aws4_request`;
  const stringToSign = [ALGORITHM, full, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(context, short))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    canonicalRequest,
    stringToSign,
    signature,
    signedHeaders: headers.signed,
    credentialScope,
    amzDate: full,
  };
}

/** Authorization ヘッダ方式。リクエストに付与すべきヘッダをすべて返す。 */
export function signWithHeaders(
  request: SigV4Request,
  context: SigV4Context,
): Readonly<Record<string, string>> {
  const withRequired: SigV4Request = {
    ...request,
    headers: {
      ...request.headers,
      host: request.host,
      'x-amz-date': amzDate(context.signedAt).full,
      'x-amz-content-sha256': request.payloadHash,
      ...(context.credentials.sessionToken === undefined
        ? {}
        : { 'x-amz-security-token': context.credentials.sessionToken }),
    },
  };
  const parts = computeSignature(withRequired, context);
  return {
    ...withRequired.headers,
    Authorization:
      `${ALGORITHM} Credential=${context.credentials.accessKeyId}/${parts.credentialScope}, `
      + `SignedHeaders=${parts.signedHeaders}, Signature=${parts.signature}`,
  };
}

/**
 * クエリ文字列方式（プリサイン URL）。
 * バケットを公開せずに、期限付きの取得 URL を外部サービスへ渡せる。
 */
export function presign(
  request: Omit<SigV4Request, 'payloadHash' | 'headers'>,
  context: SigV4Context,
  expiresInSeconds: number,
): string {
  const { full, short } = amzDate(context.signedAt);
  const query: Record<string, string> = {
    ...request.query,
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${context.credentials.accessKeyId}/${short}/${context.region}/${context.service}/aws4_request`,
    'X-Amz-Date': full,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  if (context.credentials.sessionToken !== undefined) {
    query['X-Amz-Security-Token'] = context.credentials.sessionToken;
  }

  const parts = computeSignature(
    { ...request, query, headers: { host: request.host }, payloadHash: 'UNSIGNED-PAYLOAD' },
    context,
  );
  // 署名は最後に付ける（正規化クエリには含めない）。
  const signed = `${canonicalQueryString(query)}&X-Amz-Signature=${parts.signature}`;
  return `https://${request.host}${encodePath(request.path)}?${signed}`;
}
