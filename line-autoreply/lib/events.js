// LINE Webhook のボディ解析とイベント → シート行の変換 (純粋関数)。

import { formatJst } from './time.js';
import { CONVERSATION_LOG, STATUS } from './schema.js';

/** Google スプレッドシートのセル上限は 50,000 文字。余裕をみて切り詰める。 */
export const MAX_CELL_CHARS = 40000;

/**
 * @typedef {object} WebhookBody
 * @property {string} destination
 * @property {Record<string, any>[]} events
 */

/**
 * 受信ボディを解析する。形が不正なら例外。
 * LINE の「検証」ボタンは events が空配列のボディを送るので、それは正常とみなす。
 * @param {string} text
 * @returns {WebhookBody}
 */
export function parseWebhookBody(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('リクエストボディが空です');
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('リクエストボディが JSON ではありません');
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('リクエストボディがオブジェクトではありません');
  }
  const events = json.events === undefined ? [] : json.events;
  if (!Array.isArray(events)) {
    throw new Error('events が配列ではありません');
  }
  for (const ev of events) {
    if (ev === null || typeof ev !== 'object' || typeof ev.type !== 'string') {
      throw new Error('events に不正な要素があります');
    }
  }
  return {
    destination: typeof json.destination === 'string' ? json.destination : '',
    events,
  };
}

/**
 * セルに入れる値を無害化する。
 * - 先頭が = + - @ の文字列は数式として解釈されるため、先頭にアポストロフィを付けて文字列扱いにする。
 * - 長すぎる文字列は切り詰める。
 * @param {unknown} value
 * @returns {string | number | boolean}
 */
export function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (s.length > MAX_CELL_CHARS) s = `${s.slice(0, MAX_CELL_CHARS)}…(切り詰め)`;
  return s;
}

/**
 * メッセージ本体を 1 行の文字列に要約する。テキスト以外は種別と ID を残す。
 * @param {Record<string, any> | undefined} message
 * @returns {string}
 */
export function describeMessage(message) {
  if (!message || typeof message !== 'object') return '';
  const id = message.id ? ` id=${message.id}` : '';
  switch (message.type) {
    case 'text':
      return typeof message.text === 'string' ? message.text : '';
    case 'sticker':
      return `[スタンプ packageId=${message.packageId ?? ''} stickerId=${message.stickerId ?? ''}]`;
    case 'image':
      return `[画像${id}]`;
    case 'video':
      return `[動画${id}]`;
    case 'audio':
      return `[音声${id}]`;
    case 'file':
      return `[ファイル ${message.fileName ?? ''}${id}]`;
    case 'location':
      return `[位置情報 ${message.title ?? ''} ${message.address ?? ''}]`.replace(/\s+/g, ' ').trim();
    default:
      return `[${message.type ?? 'unknown'}${id}]`;
  }
}

/**
 * メッセージ以外のイベントを 1 行の文字列に要約する。
 * @param {Record<string, any>} event
 * @returns {string}
 */
function describeNonMessageEvent(event) {
  const members = (list) =>
    Array.isArray(list) ? list.map((m) => m?.userId ?? '').filter(Boolean).join(',') : '';
  switch (event.type) {
    case 'join':
      return '[グループに参加]';
    case 'leave':
      return '[グループから退出]';
    case 'memberJoined':
      return `[メンバー参加 ${members(event.joined?.members)}]`;
    case 'memberLeft':
      return `[メンバー退出 ${members(event.left?.members)}]`;
    case 'follow':
      return '[友だち追加]';
    case 'unfollow':
      return '[ブロック]';
    case 'postback':
      return `[postback ${event.postback?.data ?? ''}]`;
    case 'unsend':
      return `[送信取消 messageId=${event.unsend?.messageId ?? ''}]`;
    default:
      return `[${event.type}]`;
  }
}

/**
 * イベント 1 件を「会話ログ」の 1 行に変換する。列順は CONVERSATION_LOG.headers と一致する。
 * @param {Record<string, any>} event
 * @param {Date} receivedAt
 * @returns {(string | number | boolean)[]}
 */
export function eventToRow(event, receivedAt) {
  const source = event.source && typeof event.source === 'object' ? event.source : {};
  const message = event.type === 'message' ? event.message : undefined;
  const body = message ? describeMessage(message) : describeNonMessageEvent(event);
  const timestamp = typeof event.timestamp === 'number' ? formatJst(event.timestamp) : '';

  const row = [
    formatJst(receivedAt),
    event.type,
    source.type ?? '',
    source.groupId ?? source.roomId ?? '',
    source.userId ?? '',
    message?.type ?? '',
    body,
    event.replyToken ?? '',
    STATUS.PENDING,
    event.webhookEventId ?? '',
    event.deliveryContext?.isRedelivery === true,
    timestamp,
    '',
    '',
    JSON.stringify(event),
  ].map(sanitizeCell);

  if (row.length !== CONVERSATION_LOG.headers.length) {
    throw new Error('会話ログの列数と行の長さが一致しません');
  }
  return row;
}
