// スプレッドシートの構成定義 (純粋データ)。
// setup() と eventToRow() が同じ定義を参照する。

export const STATUS = Object.freeze({
  PENDING: '未処理',
  DONE: '処理済',
  ERROR: 'エラー',
});

export const LEDGER_KIND = Object.freeze({
  CLIENT: '取引先',
  INTERNAL: '社内',
});

export const SETTING_KEYS = Object.freeze({
  MODE: 'mode',
});

export const MODES = Object.freeze(['approval', 'auto']);
export const DEFAULT_MODE = 'approval';

/**
 * @typedef {object} SheetDefinition
 * @property {string} name
 * @property {readonly string[]} headers
 * @property {readonly (readonly string[])[]} [initialRows]
 */

/** @type {SheetDefinition} */
export const CONVERSATION_LOG = Object.freeze({
  name: '会話ログ',
  headers: Object.freeze([
    '受信日時',
    'イベント種別',
    'ソース種別',
    'グループID',
    'ユーザーID',
    'メッセージ種別',
    '本文',
    'replyToken',
    '状態',
    'webhookEventId',
    '再送',
    'LINEタイムスタンプ',
    '処理日時',
    '処理メモ',
    '生データ',
  ]),
});

/** @type {SheetDefinition} */
export const LEDGER = Object.freeze({
  name: '取引先台帳',
  headers: Object.freeze([
    'グループID',
    '会社名',
    'グループ名',
    '区分',
    '共有スプレッドシートID',
    '共有フォルダID',
    '担当者',
    '有効',
    '備考',
  ]),
});

/** @type {SheetDefinition} */
export const SETTINGS = Object.freeze({
  name: '設定',
  headers: Object.freeze(['キー', '値', '説明']),
  initialRows: Object.freeze([
    Object.freeze([
      SETTING_KEYS.MODE,
      DEFAULT_MODE,
      'approval=承認してから送る / auto=自動送信',
    ]),
  ]),
});

/** @type {SheetDefinition} */
export const OPS_LOG = Object.freeze({
  name: '稼働ログ',
  headers: Object.freeze(['日時', 'レベル', '処理', 'グループID', '内容']),
});

/** @type {readonly SheetDefinition[]} */
export const ALL_SHEETS = Object.freeze([CONVERSATION_LOG, LEDGER, SETTINGS, OPS_LOG]);

/**
 * 見出し名から 0 始まりの列インデックスを返す。無ければ例外。
 * @param {SheetDefinition} def
 * @param {string} header
 * @returns {number}
 */
export function columnIndex(def, header) {
  const i = def.headers.indexOf(header);
  if (i < 0) throw new Error(`シート「${def.name}」に見出し「${header}」がありません`);
  return i;
}
