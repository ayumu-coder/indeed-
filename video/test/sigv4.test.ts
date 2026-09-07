import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeSignature,
  encodePath,
  presign,
  sha256Hex,
  signWithHeaders,
  uriEncode,
  type SigV4Context,
} from '../src/publish/sigv4.ts';

/**
 * 期待値は botocore（AWS 公式 SDK の署名実装）で同じリクエストを署名して得たもの。
 * 署名を自前実装しているため、外部実装との一致をゴールデン値で固定する。
 */
const CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const SIGNED_AT = new Date('2026-09-07T06:52:18Z');
const R2_HOST = 'shorts.abcdef0123456789.r2.cloudflarestorage.com';
const KEY_PATH = '/shorts/2026-01/s01 a.mp4';
const BODY_SHA = '36e270b016a9e66cae8f2c2c5d23cfd13eab7cae45a67cb8cb0367881a7e185e';

test('S3 互換ストレージへの PUT が botocore と一致する', () => {
  const context: SigV4Context = { region: 'auto', service: 's3', credentials: CREDENTIALS, signedAt: SIGNED_AT };
  const parts = computeSignature(
    {
      method: 'PUT',
      host: R2_HOST,
      path: KEY_PATH,
      query: {},
      headers: {
        'content-type': 'video/mp4',
        host: R2_HOST,
        'x-amz-content-sha256': BODY_SHA,
        'x-amz-date': '20260907T065218Z',
      },
      payloadHash: BODY_SHA,
    },
    context,
  );
  assert.equal(parts.signature, '05d66d04fd95a52d6d666c135953a053e6872bb1e16d95bd65c8adbf073c4503');
  assert.equal(parts.signedHeaders, 'content-type;host;x-amz-content-sha256;x-amz-date');
  assert.equal(parts.credentialScope, '20260907/auto/s3/aws4_request');
});

test('プリサイン URL が botocore と完全に一致する', () => {
  const url = presign(
    { method: 'GET', host: R2_HOST, path: KEY_PATH, query: {} },
    { region: 'auto', service: 's3', credentials: CREDENTIALS, signedAt: SIGNED_AT },
    900,
  );
  assert.equal(
    url,
    `https://${R2_HOST}/shorts/2026-01/s01%20a.mp4`
      + '?X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + '&X-Amz-Credential=AKIDEXAMPLE%2F20260907%2Fauto%2Fs3%2Faws4_request'
      + '&X-Amz-Date=20260907T065218Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host'
      + '&X-Amz-Signature=57e33d4b8156053e9ff46fbe0617c46e4b49aef517be613be041eb2d8d6f21b3',
  );
});

test('クエリ付き GET（IAM）も botocore と一致する', () => {
  const parts = computeSignature(
    {
      method: 'GET',
      host: 'iam.amazonaws.com',
      path: '/',
      query: { Action: 'ListUsers', Version: '2010-05-08' },
      headers: { host: 'iam.amazonaws.com', 'x-amz-date': '20260907T065218Z' },
      payloadHash: sha256Hex(''),
    },
    { region: 'us-east-1', service: 'iam', credentials: CREDENTIALS, signedAt: SIGNED_AT },
  );
  assert.equal(parts.signature, '29479926ef1556ce55e74875a141688d54425dae1cdbf27220f56049d9abfb08');
});

test('署名ヘッダに必須ヘッダが揃う', () => {
  const headers = signWithHeaders(
    { method: 'PUT', host: R2_HOST, path: KEY_PATH, query: {}, headers: {}, payloadHash: BODY_SHA },
    { region: 'auto', service: 's3', credentials: CREDENTIALS, signedAt: SIGNED_AT },
  );
  assert.equal(headers['host'], R2_HOST);
  assert.equal(headers['x-amz-date'], '20260907T065218Z');
  assert.equal(headers['x-amz-content-sha256'], BODY_SHA);
  assert.match(headers['Authorization'] ?? '', /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260907\/auto\/s3\//);
});

test('セッショントークンがある場合だけ x-amz-security-token を含める', () => {
  const withToken = signWithHeaders(
    { method: 'GET', host: R2_HOST, path: '/a', query: {}, headers: {}, payloadHash: 'UNSIGNED-PAYLOAD' },
    {
      region: 'auto',
      service: 's3',
      credentials: { ...CREDENTIALS, sessionToken: 'TOKEN' },
      signedAt: SIGNED_AT,
    },
  );
  assert.equal(withToken['x-amz-security-token'], 'TOKEN');
  const withoutToken = signWithHeaders(
    { method: 'GET', host: R2_HOST, path: '/a', query: {}, headers: {}, payloadHash: 'UNSIGNED-PAYLOAD' },
    { region: 'auto', service: 's3', credentials: CREDENTIALS, signedAt: SIGNED_AT },
  );
  assert.equal(withoutToken['x-amz-security-token'], undefined);
});

test('RFC 3986 のエスケープ対象を取りこぼさない', () => {
  assert.equal(uriEncode("a!b'c(d)e*f"), 'a%21b%27c%28d%29e%2Af');
  assert.equal(uriEncode('あ 1'), '%E3%81%82%201');
  // パス区切りは維持したまま各セグメントだけをエンコードする。
  assert.equal(encodePath('/shorts/2026-01/s01 a.mp4'), '/shorts/2026-01/s01%20a.mp4');
});
