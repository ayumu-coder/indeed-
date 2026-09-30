// 返信案ファイルの解釈、重複排除、取込時の扱いの決定、「返信案」タブの行変換 (純粋関数)。

import { DRAFTS, DRAFT_FILE_HEADERS, DRAFT_FILE_NAME_PATTERN, DRAFT_STATUS, VERDICT, columnIndex } from './schema.js';

/**
 * 返信案担当が作るファイル名か (「LINE返信案_YYYYMMDD-HHMM」で始まる)。
 * @param {unknown} name
 * @returns {boolean}
 */
export function isDraftFileName(name) {
  return typeof name === 'string' && DRAFT_FILE_NAME_PATTERN.test(name.trim());
}

/**
 * @typedef {object} DraftInput 返信案ファイルの 1 行
 * @property {string} eventId   webhookEventId
 * @property {string} groupId
 * @property {string} company
 * @property {string} received  受信本文
 * @property {string} reply     返信案
 * @property {'返信' | '人に回す'} verdict
 * @property {string} reason
 */

/**
 * @typedef {object} ParsedDraftFile
 * @property {DraftInput[]} drafts
 * @property {string[]} errors 行単位の不備。ファイル全体が読めないときは drafts が空で errors に理由
 */

/**
 * 返信案ファイルの全セル (1 行目は見出し) を解釈する。列は見出し名で引くので順序は問わない。
 * @param {readonly (readonly unknown[])[]} values
 * @returns {ParsedDraftFile}
 */
export function parseDraftFile(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { drafts: [], errors: ['ファイルが空'] };
  }
  const header = values[0].map((h) => String(h ?? '').trim());
  const index = {};
  for (const name of DRAFT_FILE_HEADERS) {
    const i = header.indexOf(name);
    if (i < 0) return { drafts: [], errors: [`見出し「${name}」がありません (1 行目: ${header.join(', ')})`] };
    index[name] = i;
  }
  const cell = (row, name) => String(row?.[index[name]] ?? '').trim();

  /** @type {DraftInput[]} */
  const drafts = [];
  /** @type {string[]} */
  const errors = [];
  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    const isBlank = !row || row.every((v) => String(v ?? '').trim() === '');
    if (isBlank) continue;
    const line = r + 1;
    const eventId = cell(row, 'webhookEventId');
    const groupId = cell(row, 'グループID');
    const verdict = cell(row, '判定');
    const reply = cell(row, '返信案');
    if (eventId === '') {
      errors.push(`${line} 行目: webhookEventId が空`);
      continue;
    }
    if (groupId === '') {
      errors.push(`${line} 行目: グループID が空`);
      continue;
    }
    if (verdict !== VERDICT.REPLY && verdict !== VERDICT.HUMAN) {
      errors.push(`${line} 行目: 判定「${verdict}」は不正 (${VERDICT.REPLY} | ${VERDICT.HUMAN})`);
      continue;
    }
    if (verdict === VERDICT.REPLY && reply === '') {
      errors.push(`${line} 行目: 判定=返信 なのに返信案が空`);
      continue;
    }
    drafts.push({
      eventId,
      groupId,
      company: cell(row, '会社名'),
      received: cell(row, '受信本文'),
      reply,
      verdict: /** @type {'返信' | '人に回す'} */ (verdict),
      reason: cell(row, '理由'),
    });
  }
  return { drafts, errors };
}

/**
 * 既に「返信案」タブにある webhookEventId と、同一ファイル内の重複を除く。
 * @param {readonly DraftInput[]} drafts
 * @param {Iterable<string>} existingEventIds
 * @returns {{ fresh: DraftInput[], duplicates: DraftInput[] }}
 */
export function dedupeDrafts(drafts, existingEventIds) {
  const seen = new Set(existingEventIds);
  const fresh = [];
  const duplicates = [];
  for (const d of drafts) {
    if (seen.has(d.eventId)) {
      duplicates.push(d);
      continue;
    }
    seen.add(d.eventId);
    fresh.push(d);
  }
  return { fresh, duplicates };
}

/**
 * @typedef {'await_approval' | 'human' | 'send' | 'hold'} ImportAction
 */

/**
 * 取込時に返信案をどう扱うか。
 * - 判定=人に回す → human (管理者へ通知のみ)
 * - mode=approval → await_approval (管理者へ承認依頼)
 * - mode=auto → 安全確認を通れば send、通らなければ hold
 * @param {{ verdict: string, mode: 'approval' | 'auto', safety: { ok: boolean } }} input
 * @returns {ImportAction}
 */
export function decideImportAction(input) {
  if (input.verdict === VERDICT.HUMAN) return 'human';
  if (input.mode !== 'auto') return 'await_approval';
  return input.safety.ok ? 'send' : 'hold';
}

/**
 * ImportAction に対応する「返信案」タブの初期状態。send は送信結果で確定するため承認待ちを経ずに一旦 送信保留 とし、
 * 送信処理側が 送信済 / 送信失敗 に更新する。
 * @param {ImportAction} action
 * @returns {string}
 */
export function initialDraftStatus(action) {
  switch (action) {
    case 'human':
      return DRAFT_STATUS.HUMAN;
    case 'await_approval':
      return DRAFT_STATUS.WAITING_APPROVAL;
    case 'send':
    case 'hold':
      return DRAFT_STATUS.HELD;
    default:
      throw new Error(`不明な取込アクション: ${action}`);
  }
}

/**
 * 「返信案」タブへ追記する 1 行を作る。列順は DRAFTS.headers と一致する。
 * @param {{ number: number, draft: DraftInput, status: string, createdAt: string, source: string }} input
 * @returns {(string | number)[]}
 */
export function buildDraftRow(input) {
  const row = new Array(DRAFTS.headers.length).fill('');
  const set = (h, v) => {
    row[columnIndex(DRAFTS, h)] = v;
  };
  set('番号', input.number);
  set('webhookEventId', input.draft.eventId);
  set('グループID', input.draft.groupId);
  set('会社名', input.draft.company);
  set('受信本文', input.draft.received);
  set('返信案', input.draft.reply);
  set('判定', input.draft.verdict);
  set('理由', input.draft.reason);
  set('状態', input.status);
  set('作成日時', input.createdAt);
  set('取込元', input.source);
  return row;
}

/**
 * @typedef {object} DraftRecord 「返信案」タブの 1 行
 * @property {number} rowIndex  見出しを除いた 0 始まりの添字
 * @property {number} number
 * @property {string} eventId
 * @property {string} groupId
 * @property {string} company
 * @property {string} received
 * @property {string} reply
 * @property {string} verdict
 * @property {string} reason
 * @property {string} status
 */

/**
 * 「返信案」タブのデータ行 (見出し除く) を DraftRecord に変換する。番号が数値でない行は捨てる。
 * @param {readonly (readonly unknown[])[]} rows
 * @returns {DraftRecord[]}
 */
export function parseDraftRecords(rows) {
  const get = (row, h) => String(row?.[columnIndex(DRAFTS, h)] ?? '').trim();
  const out = [];
  rows.forEach((row, rowIndex) => {
    const number = Number(row?.[columnIndex(DRAFTS, '番号')]);
    if (!Number.isInteger(number) || number <= 0) return;
    out.push({
      rowIndex,
      number,
      eventId: get(row, 'webhookEventId'),
      groupId: get(row, 'グループID'),
      company: get(row, '会社名'),
      received: get(row, '受信本文'),
      reply: get(row, '返信案'),
      verdict: get(row, '判定'),
      reason: get(row, '理由'),
      status: get(row, '状態'),
    });
  });
  return out;
}

/**
 * 次に採番する番号 (既存の最大 + 1、無ければ 1)。
 * @param {readonly DraftRecord[]} records
 * @returns {number}
 */
export function nextDraftNumber(records) {
  let max = 0;
  for (const r of records) if (r.number > max) max = r.number;
  return max + 1;
}

/**
 * 番号で返信案を探す。同じ番号が複数あれば最後の行を返す。
 * @param {readonly DraftRecord[]} records
 * @param {number} number
 * @returns {DraftRecord | null}
 */
export function findDraftByNumber(records, number) {
  let found = null;
  for (const r of records) if (r.number === number) found = r;
  return found;
}
