// 日時ユーティリティ (純粋関数)。Node / GAS 双方で動く。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Date を "YYYY-MM-DD HH:mm:ss" (JST) に整形する。
 * 不正な値は空文字を返す (ログ行を落とさないため例外にしない)。
 * @param {Date | number | string} value
 * @returns {string}
 */
export function formatJst(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  const t = new Date(ms + JST_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ` +
    `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`
  );
}
