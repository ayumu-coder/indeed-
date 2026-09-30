// スプレッドシートの構成定義 (純粋データ)。
// setup() と eventToRow() が同じ定義を参照する。

export const STATUS = Object.freeze({
  PENDING: '未処理',
  DONE: '処理済',
  ERROR: 'エラー',
  /** 取引先グループの message。返信案担当が返信案を書くのを待っている */
  WAITING_DRAFT: '返信案待ち',
  /** 返信案を取り込み、管理者の OK/却下 を待っている */
  WAITING_APPROVAL: '承認待ち',
  /** 返信案担当が「人に回す」と判定した */
  HUMAN: '人に回す',
  /** グループへ返信を送った */
  REPLIED: '返信済',
});

/** 「返信案」タブの状態 */
export const DRAFT_STATUS = Object.freeze({
  WAITING_APPROVAL: '承認待ち',
  HUMAN: '人に回す',
  SENT: '送信済',
  SEND_FAILED: '送信失敗',
  HELD: '送信保留',
  REJECTED: '却下',
});

/** 返信案担当が書く「判定」列の値 */
export const VERDICT = Object.freeze({
  REPLY: '返信',
  HUMAN: '人に回す',
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

/** 取り込んだ返信案。1 行 = 1 案。番号は管理者が OK/却下 で指す ID */
/** @type {SheetDefinition} */
export const DRAFTS = Object.freeze({
  name: '返信案',
  headers: Object.freeze([
    '番号',
    'webhookEventId',
    'グループID',
    '会社名',
    '受信本文',
    '返信案',
    '判定',
    '理由',
    '状態',
    '作成日時',
    '承認日時',
    '送信結果',
    '取込元',
  ]),
});

/** 取り込み済みの返信案ファイル (同じファイルを二度読まないための記録) */
/** @type {SheetDefinition} */
export const IMPORTED = Object.freeze({
  name: '取込済',
  headers: Object.freeze(['ファイルID', 'ファイル名', '取込日時', '取込件数', '重複件数', '備考']),
});

/**
 * 返信案担当が作るファイル (Google スプレッドシート or CSV) の 1 行目。
 * ファイル名は「LINE返信案_YYYYMMDD-HHMM」。
 */
export const DRAFT_FILE_HEADERS = Object.freeze([
  'webhookEventId',
  'グループID',
  '会社名',
  '受信本文',
  '返信案',
  '判定',
  '理由',
]);
export const DRAFT_FILE_NAME_PREFIX = 'LINE返信案_';
export const DRAFT_FILE_NAME_PATTERN = /^LINE返信案_\d{8}-\d{4}/;

/** @type {readonly SheetDefinition[]} */
export const ALL_SHEETS = Object.freeze([CONVERSATION_LOG, LEDGER, SETTINGS, OPS_LOG, DRAFTS, IMPORTED]);

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
