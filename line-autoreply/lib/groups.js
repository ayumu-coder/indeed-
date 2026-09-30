// 取引先台帳への自動登録と、送信者名の解決に使う純粋関数 (第 3 歩)。
// Messaging API の呼び出し自体は gas/src/entry.js が行い、ここは応答の解釈と行の組み立てだけを担う。

import { CONVERSATION_LOG, DEFAULT_AUTO_REGISTER_EXCLUDE, LEDGER, LEDGER_KIND, SETTING_KEYS, columnIndex } from './schema.js';
import { formatJst } from './time.js';

/** 送信者名のキャッシュ有効期間 (秒)。CacheService の上限は 6 時間 */
export const SENDER_NAME_CACHE_SECONDS = 6 * 60 * 60;
/** 取得失敗を短時間だけ覚えて連続呼び出しを抑える (秒) */
export const SENDER_NAME_FAILURE_CACHE_SECONDS = 10 * 60;
/** 会社名・グループ名・送信者名としてシートに書く長さの上限 */
export const NAME_MAX_CHARS = 200;

/**
 * 「設定」の auto_register_exclude (カンマ・空白区切り) と既定の除外 ID を合わせた集合を返す。
 * @param {Record<string, string>} settings
 * @returns {Set<string>}
 */
export function resolveAutoRegisterExclude(settings) {
  const out = new Set(DEFAULT_AUTO_REGISTER_EXCLUDE);
  const raw = String(settings?.[SETTING_KEYS.AUTO_REGISTER_EXCLUDE] ?? '');
  for (const id of raw.split(/[\s,、]+/)) {
    if (id !== '') out.add(id);
  }
  return out;
}

/**
 * 備考に書く「自動登録 YYYY-MM-DD HH:mm」。
 * @param {Date} date
 * @returns {string}
 */
export function formatAutoRegisterNote(date) {
  return `自動登録 ${formatJst(date).slice(0, 16)}`;
}

/**
 * Messaging API の応答 (グループ概要 / メンバープロフィール) から名前を取り出す。無ければ空文字。
 * @param {unknown} json
 * @param {'groupName' | 'displayName'} field
 * @returns {string}
 */
export function pickName(json, field) {
  if (json === null || typeof json !== 'object') return '';
  const value = /** @type {Record<string, unknown>} */ (json)[field];
  if (typeof value !== 'string') return '';
  const chars = Array.from(value.trim());
  return chars.length <= NAME_MAX_CHARS ? chars.join('') : `${chars.slice(0, NAME_MAX_CHARS).join('')}…`;
}

/**
 * 送信者名キャッシュのキー (CacheService のキーは 250 文字以内)。
 * @param {string} groupId
 * @param {string} userId
 * @returns {string}
 */
export function senderCacheKey(groupId, userId) {
  return `sender:${groupId}:${userId}`;
}

/**
 * 取引先台帳へ自動登録する 1 行を作る。列順は LEDGER.headers と一致する。
 * 会社名・グループ名にはグループ名 (取得失敗時は空) を入れ、区分=取引先、有効=TRUE、備考=「自動登録 日時」。
 * @param {{ groupId: string, groupName: string, registeredAt: Date }} input
 * @returns {(string | boolean)[]}
 */
export function buildAutoLedgerRow(input) {
  const row = new Array(LEDGER.headers.length).fill('');
  const set = (h, v) => {
    row[columnIndex(LEDGER, h)] = v;
  };
  set('グループID', input.groupId);
  set('会社名', input.groupName);
  set('グループ名', input.groupName);
  set('区分', LEDGER_KIND.CLIENT);
  set('有効', true);
  set('備考', formatAutoRegisterNote(input.registeredAt));
  return row;
}

/**
 * join 行を自動登録すべきか (グループ発の join で、台帳に無く、除外リストにも無い)。
 * @param {import('./ledger.js').EventInfo} info
 * @param {Map<string, import('./ledger.js').LedgerEntry>} ledger
 * @param {Set<string>} exclude
 * @returns {boolean}
 */
export function shouldAutoRegisterOnJoin(info, ledger, exclude) {
  return info.eventType === 'join' && info.sourceType === 'group' && info.groupId !== '' && !ledger.has(info.groupId) && !exclude.has(info.groupId);
}

/**
 * 会話ログ (見出しを除いた全データ行、古い順) から、台帳に無いグループ ID を初出順に返す。
 * 最後のイベントが leave のグループ (ボットが退出済み) と、除外リストのグループは含めない。
 * @param {readonly (readonly unknown[])[]} rows
 * @param {Map<string, import('./ledger.js').LedgerEntry>} ledger
 * @param {Set<string>} exclude
 * @returns {string[]}
 */
export function findUnregisteredGroupIds(rows, ledger, exclude) {
  const typeCol = columnIndex(CONVERSATION_LOG, 'イベント種別');
  const sourceCol = columnIndex(CONVERSATION_LOG, 'ソース種別');
  const groupCol = columnIndex(CONVERSATION_LOG, 'グループID');
  /** @type {Map<string, string>} グループID → 最後のイベント種別 */
  const lastEvent = new Map();
  for (const row of rows) {
    if (String(row?.[sourceCol] ?? '').trim() !== 'group') continue;
    const groupId = String(row?.[groupCol] ?? '').trim();
    if (groupId === '') continue;
    lastEvent.set(groupId, String(row?.[typeCol] ?? '').trim());
  }
  const out = [];
  for (const [groupId, type] of lastEvent) {
    if (type === 'leave') continue;
    if (ledger.has(groupId) || exclude.has(groupId)) continue;
    out.push(groupId);
  }
  return out;
}

/**
 * 送信者名を取りに行くべき行か (グループ発の message で送信者のユーザー ID がある)。
 * @param {import('./ledger.js').EventInfo} info
 * @returns {boolean}
 */
export function needsSenderName(info) {
  return info.eventType === 'message' && info.sourceType === 'group' && info.groupId !== '' && info.userId !== '';
}
