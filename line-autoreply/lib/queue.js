// 「設定」シートの解釈と「会話ログ」の未処理行の抽出 (純粋関数)。

import { DEFAULT_MODE, MODES, SETTING_KEYS, STATUS } from './schema.js';

/**
 * 「設定」シートのデータ行 (見出し除く) を key→value に変換する。
 * 空キーは無視し、同じキーは後勝ち。値は文字列化して trim する。
 * @param {readonly (readonly unknown[])[]} rows
 * @returns {Record<string, string>}
 */
export function parseSettings(rows) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const row of rows) {
    const key = String(row?.[0] ?? '').trim();
    if (key === '') continue;
    out[key] = String(row?.[1] ?? '').trim();
  }
  return out;
}

/**
 * @typedef {object} ModeResolution
 * @property {'approval' | 'auto'} mode
 * @property {string | null} warning 不正値だった場合の説明。正常なら null
 */

/**
 * 送信モードを決める。未設定・不正値は安全側 (approval) に倒す。
 * @param {Record<string, string>} settings
 * @returns {ModeResolution}
 */
export function resolveMode(settings) {
  const raw = (settings[SETTING_KEYS.MODE] ?? '').toLowerCase();
  if (raw === '') {
    return { mode: DEFAULT_MODE, warning: `設定 ${SETTING_KEYS.MODE} が未設定のため ${DEFAULT_MODE} で動作` };
  }
  if (!MODES.includes(raw)) {
    return {
      mode: DEFAULT_MODE,
      warning: `設定 ${SETTING_KEYS.MODE}=「${raw}」は不正 (${MODES.join(' | ')}) のため ${DEFAULT_MODE} で動作`,
    };
  }
  return { mode: /** @type {'approval' | 'auto'} */ (raw), warning: null };
}

/**
 * 状態が「未処理」のデータ行 (0 始まり、見出しを除いた配列内の添字) を古い順に返す。
 * @param {readonly (readonly unknown[])[]} rows 見出しを除いたデータ行
 * @param {number} statusColumnIndex
 * @param {number} limit 1 回に処理する最大件数
 * @returns {number[]}
 */
export function findPendingRowIndexes(rows, statusColumnIndex, limit) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit は正の整数');
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < rows.length && out.length < limit; i += 1) {
    if (rows[i]?.[statusColumnIndex] === STATUS.PENDING) out.push(i);
  }
  return out;
}
