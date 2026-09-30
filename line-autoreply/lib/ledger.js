// 取引先台帳の解釈と、会話ログ 1 行の振り分け (純粋関数)。

import { CONVERSATION_LOG, LEDGER, LEDGER_KIND, columnIndex } from './schema.js';

/**
 * @typedef {object} LedgerEntry
 * @property {string} groupId
 * @property {string} company
 * @property {string} groupName
 * @property {string} kind        区分 (取引先 / 社内 / その他の文字列)
 * @property {string} sheetId
 * @property {string} folderId
 * @property {string} contact     担当者
 * @property {boolean} enabled    有効=TRUE
 * @property {string} note
 */

/**
 * 「有効」列の値を真偽に丸める。チェックボックス (boolean) と文字列 TRUE を受け付ける。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().toUpperCase() === 'TRUE';
  return false;
}

/**
 * 「取引先台帳」のデータ行 (見出し除く) を グループID → LedgerEntry に変換する。
 * グループID が空の行は無視。同じ グループID は後勝ち。
 * @param {readonly (readonly unknown[])[]} rows
 * @returns {Map<string, LedgerEntry>}
 */
export function parseLedger(rows) {
  const col = (h) => columnIndex(LEDGER, h);
  const str = (row, h) => String(row?.[col(h)] ?? '').trim();
  /** @type {Map<string, LedgerEntry>} */
  const out = new Map();
  for (const row of rows) {
    const groupId = str(row, 'グループID');
    if (groupId === '') continue;
    out.set(groupId, {
      groupId,
      company: str(row, '会社名'),
      groupName: str(row, 'グループ名'),
      kind: str(row, '区分'),
      sheetId: str(row, '共有スプレッドシートID'),
      folderId: str(row, '共有フォルダID'),
      contact: str(row, '担当者'),
      enabled: isTruthyFlag(row?.[col('有効')]),
      note: str(row, '備考'),
    });
  }
  return out;
}

/**
 * 返信を送ってよい相手か (区分=取引先 かつ 有効=TRUE)。
 * @param {LedgerEntry | undefined} entry
 * @returns {boolean}
 */
export function isSendableClient(entry) {
  return !!entry && entry.kind === LEDGER_KIND.CLIENT && entry.enabled === true;
}

/**
 * @typedef {object} EventInfo
 * @property {string} eventType    message / join / ...
 * @property {string} sourceType   user / group / room
 * @property {string} groupId
 * @property {string} userId
 * @property {string} messageType  text / sticker / ...
 * @property {string} text         本文
 */

/**
 * 「会話ログ」の 1 行から振り分けに必要な値を取り出す。
 * @param {readonly unknown[]} row 見出しを除いたデータ行
 * @returns {EventInfo}
 */
export function rowToEventInfo(row) {
  const get = (h) => String(row?.[columnIndex(CONVERSATION_LOG, h)] ?? '').trim();
  return {
    eventType: get('イベント種別'),
    sourceType: get('ソース種別'),
    groupId: get('グループID'),
    userId: get('ユーザーID'),
    messageType: get('メッセージ種別'),
    text: String(row?.[columnIndex(CONVERSATION_LOG, '本文')] ?? ''),
  };
}

/** 処理メモに書く「対象外」の理由 */
export const SKIP_REASON = Object.freeze({
  INTERNAL: '対象外 (社内)',
  UNREGISTERED: '対象外 (未登録)',
  DISABLED: '対象外 (無効)',
  UNKNOWN_KIND: '対象外 (区分が取引先ではない)',
  NOT_MESSAGE: '対象外 (メッセージ以外)',
  NOT_TEXT: '対象外 (テキスト以外)',
  EMPTY_TEXT: '対象外 (本文なし)',
  DIRECT_NOT_ADMIN: '対象外 (管理者以外の 1 対 1)',
  DIRECT_NOT_TEXT: '対象外 (1 対 1 のテキスト以外)',
});

/**
 * @typedef {{ kind: 'skip', memo: string }
 *   | { kind: 'await_draft', entry: LedgerEntry }
 *   | { kind: 'admin_command', text: string }} Triage
 */

/**
 * 会話ログ 1 行をどう扱うか決める。
 * - 1 対 1 (user): 管理者からのテキストは承認コマンド、それ以外は対象外。
 * - グループ: 台帳で 区分=取引先 かつ 有効=TRUE のテキストメッセージだけ返信案待ちにする。
 * @param {EventInfo} info
 * @param {Map<string, LedgerEntry>} ledger
 * @param {string | null | undefined} adminUserId
 * @returns {Triage}
 */
export function triageEvent(info, ledger, adminUserId) {
  const admin = String(adminUserId ?? '').trim();

  if (info.sourceType === 'user') {
    if (admin === '' || info.userId !== admin) return { kind: 'skip', memo: SKIP_REASON.DIRECT_NOT_ADMIN };
    if (info.eventType !== 'message' || info.messageType !== 'text') {
      return { kind: 'skip', memo: SKIP_REASON.DIRECT_NOT_TEXT };
    }
    return { kind: 'admin_command', text: info.text };
  }

  const entry = ledger.get(info.groupId);
  if (!entry) return { kind: 'skip', memo: SKIP_REASON.UNREGISTERED };
  if (entry.kind === LEDGER_KIND.INTERNAL) return { kind: 'skip', memo: SKIP_REASON.INTERNAL };
  if (!entry.enabled) return { kind: 'skip', memo: SKIP_REASON.DISABLED };
  if (entry.kind !== LEDGER_KIND.CLIENT) return { kind: 'skip', memo: SKIP_REASON.UNKNOWN_KIND };
  if (info.eventType !== 'message') return { kind: 'skip', memo: SKIP_REASON.NOT_MESSAGE };
  if (info.messageType !== 'text') return { kind: 'skip', memo: SKIP_REASON.NOT_TEXT };
  if (info.text.trim() === '') return { kind: 'skip', memo: SKIP_REASON.EMPTY_TEXT };
  return { kind: 'await_draft', entry };
}
