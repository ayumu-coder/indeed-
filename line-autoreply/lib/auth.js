// Webhook リクエストの認証 (純粋関数)。
//
// LINE Messaging API は X-Line-Signature ヘッダに
// base64(HMAC-SHA256(channelSecret, rawBody)) を載せて送ってくる。
// ただし Google Apps Script の doPost はリクエストヘッダを受け取れないため、
// GAS 上では署名が取れない。その場合は
//   1. Webhook URL に付けた秘密トークン (?token=...) の一致
//   2. body.destination (送信先ボットのユーザー ID) の一致 (設定されていれば)
// で代替する。署名ヘッダが取れる環境では署名を必ず検証する。

/**
 * タイミング攻撃に配慮した文字列比較。
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * X-Line-Signature を検証する。
 * @param {string} body 受信した生のリクエストボディ
 * @param {unknown} signatureHeader X-Line-Signature ヘッダの値
 * @param {unknown} channelSecret チャネルシークレット
 * @param {(value: string, key: string) => string} hmacSha256Base64 環境依存の HMAC 実装
 * @returns {boolean}
 */
export function verifyLineSignature(body, signatureHeader, channelSecret, hmacSha256Base64) {
  if (typeof body !== 'string') return false;
  if (typeof channelSecret !== 'string' || channelSecret === '') return false;
  if (typeof signatureHeader !== 'string' || signatureHeader === '') return false;
  const expected = hmacSha256Base64(body, channelSecret);
  return constantTimeEqual(expected, signatureHeader);
}

/**
 * @typedef {object} AuthInput
 * @property {string} body
 * @property {string | null | undefined} signatureHeader  取得できなければ null
 * @property {string | null | undefined} channelSecret
 * @property {(value: string, key: string) => string} hmacSha256Base64
 * @property {string | null | undefined} queryToken       URL の ?token= の値
 * @property {string | null | undefined} webhookToken     スクリプトプロパティ WEBHOOK_TOKEN
 * @property {string | null | undefined} destination      body.destination
 * @property {string | null | undefined} botUserId        スクリプトプロパティ LINE_BOT_USER_ID (任意)
 */

/**
 * @typedef {object} AuthResult
 * @property {boolean} ok
 * @property {'signature' | 'token' | 'none'} method
 * @property {string} reason
 */

/**
 * Webhook リクエストを認証する。
 * 署名ヘッダがあれば署名のみで判定し、無ければトークン方式にフォールバックする。
 * @param {AuthInput} input
 * @returns {AuthResult}
 */
export function authenticateWebhookRequest(input) {
  const signatureHeader = input.signatureHeader ?? null;

  if (signatureHeader !== null) {
    const ok = verifyLineSignature(
      input.body,
      signatureHeader,
      input.channelSecret,
      input.hmacSha256Base64,
    );
    return ok
      ? { ok: true, method: 'signature', reason: 'signature_ok' }
      : { ok: false, method: 'signature', reason: 'signature_mismatch' };
  }

  const webhookToken = input.webhookToken ?? '';
  if (webhookToken === '') {
    return { ok: false, method: 'none', reason: 'no_signature_and_no_webhook_token' };
  }
  if (!constantTimeEqual(input.queryToken ?? '', webhookToken)) {
    return { ok: false, method: 'token', reason: 'token_mismatch' };
  }
  const botUserId = input.botUserId ?? '';
  if (botUserId !== '' && !constantTimeEqual(input.destination ?? '', botUserId)) {
    return { ok: false, method: 'token', reason: 'destination_mismatch' };
  }
  return { ok: true, method: 'token', reason: 'token_ok' };
}
