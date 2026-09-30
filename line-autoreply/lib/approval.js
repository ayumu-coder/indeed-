// 管理者の承認コマンド解釈、送信前の安全確認、管理者向け本文の組み立て (純粋関数)。

import { LEDGER_KIND } from './schema.js';

/**
 * 全角英数・全角空白・記号の揺れを NFKC で吸収し、空白を 1 つにまとめる。
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeCommandText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @typedef {object} ApprovalCommand
 * @property {'approve' | 'reject'} action
 * @property {number} number 返信案の番号
 */

/**
 * 「OK 12」「却下 12」「ＯＫ　１２」「ok#12」などを解釈する。該当しなければ null。
 * @param {unknown} text
 * @returns {ApprovalCommand | null}
 */
export function parseApprovalCommand(text) {
  const normalized = normalizeCommandText(text);
  const m = /^(ok|却下)\s*#?\s*(\d{1,9})$/i.exec(normalized);
  if (!m) return null;
  return {
    action: m[1].toLowerCase() === 'ok' ? 'approve' : 'reject',
    number: Number(m[2]),
  };
}

/** 返信案に含まれてはいけない金額表現 */
export const MONEY_MARKERS = Object.freeze(['万円', '円', '¥', '￥']);

/**
 * @typedef {object} SafetyResult
 * @property {boolean} ok
 * @property {string[]} reasons 引っかかった理由 (ok なら空)
 */

/**
 * グループへ送る直前の安全確認。1 つでも引っかかれば送らない。
 * - 本文に金額表現 (円 / ¥ / 万円) が無い
 * - 取引先台帳の「他社」(区分=取引先 で会社名が送信先と異なる) の会社名を含まない
 * - 送信先が台帳に登録され、区分=取引先 かつ 有効=TRUE である
 * @param {{ text: string, groupId: string, ledger: Map<string, import('./ledger.js').LedgerEntry> }} input
 * @returns {SafetyResult}
 */
export function checkSendSafety(input) {
  const text = String(input.text ?? '');
  const reasons = [];

  if (text.trim() === '') reasons.push('返信案が空');

  for (const marker of MONEY_MARKERS) {
    if (text.includes(marker)) {
      reasons.push(`金額表現「${marker}」を含む`);
      break;
    }
  }

  const target = input.ledger.get(input.groupId);
  if (!target) {
    reasons.push('送信先グループが台帳に未登録');
  } else if (target.kind !== LEDGER_KIND.CLIENT) {
    reasons.push(`送信先の区分が取引先ではない (${target.kind || '空'})`);
  } else if (!target.enabled) {
    reasons.push('送信先グループが無効');
  }

  const targetCompany = target ? target.company : '';
  const seen = new Set();
  for (const entry of input.ledger.values()) {
    if (entry.kind !== LEDGER_KIND.CLIENT) continue;
    if (entry.company === '' || entry.company === targetCompany) continue;
    if (seen.has(entry.company)) continue;
    seen.add(entry.company);
    if (text.includes(entry.company)) reasons.push(`他社名「${entry.company}」を含む`);
  }

  return { ok: reasons.length === 0, reasons };
}

/** 承認依頼に載せる受信本文の上限 */
export const RECEIVED_PREVIEW_CHARS = 100;

/**
 * @param {unknown} text
 * @param {number} max
 * @returns {string}
 */
export function truncateText(text, max) {
  const s = String(text ?? '');
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max).join('')}…`;
}

/**
 * @typedef {object} DraftSummary
 * @property {number} number
 * @property {string} company
 * @property {string} received 受信本文
 * @property {string} reply    返信案
 * @property {string} reason   判定理由
 * @property {string} [sender] 受信メッセージの送信者名 (会話ログの「送信者名」。無ければ空)
 */

/**
 * 「受信: …」の行。送信者名が分かっていれば「受信 (送信者名): …」にする。
 * @param {DraftSummary} d
 * @returns {string}
 */
function buildReceivedLine(d) {
  const sender = String(d.sender ?? '').trim();
  const label = sender === '' ? '受信' : `受信 (${sender})`;
  return `${label}: ${truncateText(d.received, RECEIVED_PREVIEW_CHARS)}`;
}

/**
 * 承認依頼 (判定=返信) の本文。
 * @param {DraftSummary} d
 * @returns {string}
 */
export function buildApprovalRequestText(d) {
  return [
    `案 #${d.number}【${d.company}】`,
    buildReceivedLine(d),
    `返信案: ${d.reply}`,
    `→ 送るなら『OK ${d.number}』、送らないなら『却下 ${d.number}』`,
  ].join('\n');
}

/**
 * 人に回す (判定=人に回す) の通知本文。OK/却下 は受け付けない。
 * @param {DraftSummary} d
 * @returns {string}
 */
export function buildHumanNoticeText(d) {
  return [`人に回す #${d.number}【${d.company}】`, buildReceivedLine(d), `理由: ${d.reason}`].join('\n');
}

/**
 * 安全確認で送信を保留したときの通知本文。
 * @param {DraftSummary} d
 * @param {readonly string[]} reasons
 * @returns {string}
 */
export function buildHoldNoticeText(d, reasons) {
  return [`送信保留 #${d.number}【${d.company}】`, `理由: ${reasons.join(' / ')}`, '返信案は「返信案」タブで確認してください'].join('\n');
}

/**
 * 番号が無い・状態が違うときの返答。
 * @param {ApprovalCommand} cmd
 * @param {string | null} currentStatus 見つかった案の状態。無ければ null
 * @returns {string}
 */
export function buildNoMatchText(cmd, currentStatus) {
  const label = cmd.action === 'approve' ? 'OK' : '却下';
  if (currentStatus === null) return `該当なし: #${cmd.number} の返信案はありません (${label})`;
  return `該当なし: #${cmd.number} は「${currentStatus}」のため ${label} できません`;
}
