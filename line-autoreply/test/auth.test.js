import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  authenticateWebhookRequest,
  constantTimeEqual,
  verifyLineSignature,
} from '../lib/auth.js';

const SECRET = 'test-channel-secret';
const hmac = (value, key) => createHmac('sha256', key).update(value, 'utf8').digest('base64');
const body = JSON.stringify({ destination: 'Ubot', events: [{ type: 'message' }] });

test('constantTimeEqual: 同じ文字列のみ true', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('', ''), true);
  assert.equal(constantTimeEqual(null, 'abc'), false);
  assert.equal(constantTimeEqual('abc', undefined), false);
});

test('verifyLineSignature: 正しい署名は通る', () => {
  const sig = hmac(body, SECRET);
  assert.equal(verifyLineSignature(body, sig, SECRET, hmac), true);
});

test('verifyLineSignature: 本文改ざん・別シークレット・空署名は落ちる', () => {
  const sig = hmac(body, SECRET);
  assert.equal(verifyLineSignature(`${body} `, sig, SECRET, hmac), false);
  assert.equal(verifyLineSignature(body, sig, 'other', hmac), false);
  assert.equal(verifyLineSignature(body, '', SECRET, hmac), false);
  assert.equal(verifyLineSignature(body, sig, '', hmac), false);
  assert.equal(verifyLineSignature(body, sig, undefined, hmac), false);
});

test('verifyLineSignature: 日本語本文でも UTF-8 でハッシュされる', () => {
  const jp = JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text: 'お世話になります' } }] });
  assert.equal(verifyLineSignature(jp, hmac(jp, SECRET), SECRET, hmac), true);
});

const base = {
  body,
  channelSecret: SECRET,
  hmacSha256Base64: hmac,
  queryToken: 'tok',
  webhookToken: 'tok',
  destination: 'Ubot',
  botUserId: 'Ubot',
};

test('authenticate: 署名ヘッダがあれば署名で判定 (トークンは見ない)', () => {
  const ok = authenticateWebhookRequest({ ...base, signatureHeader: hmac(body, SECRET), queryToken: 'wrong' });
  assert.deepEqual(ok, { ok: true, method: 'signature', reason: 'signature_ok' });

  const ng = authenticateWebhookRequest({ ...base, signatureHeader: 'bad', queryToken: 'tok' });
  assert.deepEqual(ng, { ok: false, method: 'signature', reason: 'signature_mismatch' });
});

test('authenticate: 署名なし → トークン一致 + destination 一致で通る', () => {
  const r = authenticateWebhookRequest({ ...base, signatureHeader: null });
  assert.deepEqual(r, { ok: true, method: 'token', reason: 'token_ok' });
});

test('authenticate: 署名なし + WEBHOOK_TOKEN 未設定は拒否', () => {
  const r = authenticateWebhookRequest({ ...base, signatureHeader: null, webhookToken: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_signature_and_no_webhook_token');
});

test('authenticate: トークン不一致・欠落は拒否', () => {
  assert.equal(authenticateWebhookRequest({ ...base, signatureHeader: null, queryToken: 'x' }).reason, 'token_mismatch');
  assert.equal(authenticateWebhookRequest({ ...base, signatureHeader: null, queryToken: undefined }).reason, 'token_mismatch');
});

test('authenticate: botUserId 設定時は destination 不一致を拒否、未設定なら見ない', () => {
  const ng = authenticateWebhookRequest({ ...base, signatureHeader: null, destination: 'Uother' });
  assert.equal(ng.reason, 'destination_mismatch');
  const ok = authenticateWebhookRequest({ ...base, signatureHeader: null, destination: 'Uother', botUserId: '' });
  assert.equal(ok.ok, true);
});
