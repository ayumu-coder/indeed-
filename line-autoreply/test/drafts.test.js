import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftRow,
  decideImportAction,
  dedupeDrafts,
  findDraftByNumber,
  initialDraftStatus,
  isDraftFileName,
  nextDraftNumber,
  parseDraftFile,
  parseDraftRecords,
} from '../lib/drafts.js';
import { DRAFTS, DRAFT_FILE_HEADERS, DRAFT_STATUS, columnIndex } from '../lib/schema.js';

const HEADER = [...DRAFT_FILE_HEADERS];

test('isDraftFileName: LINE返信案_YYYYMMDD-HHMM で始まる名前だけ', () => {
  assert.equal(isDraftFileName('LINE返信案_20260930-1400'), true);
  assert.equal(isDraftFileName('LINE返信案_20260930-1400.csv'), true);
  assert.equal(isDraftFileName(' LINE返信案_20260930-1400 '), true);
  assert.equal(isDraftFileName('LINE返信案_2026-09-30'), false);
  assert.equal(isDraftFileName('返信案_20260930-1400'), false);
  assert.equal(isDraftFileName('メモ'), false);
  assert.equal(isDraftFileName(null), false);
});

test('parseDraftFile: 見出し名で列を引く (順序が違っても読める)', () => {
  const values = [
    ['判定', 'webhookEventId', '理由', 'グループID', '会社名', '受信本文', '返信案'],
    ['返信', 'e1', '', 'C1', 'A社', '納期は?', '来週です'],
  ];
  const r = parseDraftFile(values);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.drafts, [
    { eventId: 'e1', groupId: 'C1', company: 'A社', received: '納期は?', reply: '来週です', verdict: '返信', reason: '' },
  ]);
});

test('parseDraftFile: 空行を飛ばし、不備の行は errors に入れて残りは読む', () => {
  const values = [
    HEADER,
    ['e1', 'C1', 'A社', 'q', '返信文', '返信', ''],
    ['', '', '', '', '', '', ''],
    ['', 'C1', 'A社', 'q', '返信文', '返信', ''],
    ['e3', '', 'A社', 'q', '返信文', '返信', ''],
    ['e4', 'C1', 'A社', 'q', '返信文', '保留', ''],
    ['e5', 'C1', 'A社', 'q', '', '返信', ''],
    ['e6', 'C1', 'A社', '値引きは?', '', '人に回す', '金額の話'],
  ];
  const r = parseDraftFile(values);
  assert.deepEqual(r.drafts.map((d) => d.eventId), ['e1', 'e6']);
  assert.equal(r.errors.length, 4);
  assert.match(r.errors[0], /4 行目: webhookEventId が空/);
  assert.match(r.errors[1], /5 行目: グループID が空/);
  assert.match(r.errors[2], /6 行目: 判定「保留」は不正/);
  assert.match(r.errors[3], /7 行目: 判定=返信 なのに返信案が空/);
});

test('parseDraftFile: 見出しが欠けていれば全体を読まない', () => {
  const r = parseDraftFile([['webhookEventId', 'グループID'], ['e1', 'C1']]);
  assert.deepEqual(r.drafts, []);
  assert.match(r.errors[0], /見出し「会社名」がありません/);
  assert.deepEqual(parseDraftFile([]).drafts, []);
});

test('dedupeDrafts: 既存の webhookEventId と同一ファイル内の重複を除く', () => {
  const d = (eventId) => ({ eventId, groupId: 'C1', company: '', received: '', reply: 'r', verdict: '返信', reason: '' });
  const { fresh, duplicates } = dedupeDrafts([d('e1'), d('e2'), d('e2'), d('e3')], ['e1']);
  assert.deepEqual(fresh.map((x) => x.eventId), ['e2', 'e3']);
  assert.deepEqual(duplicates.map((x) => x.eventId), ['e1', 'e2']);
});

test('decideImportAction: 人に回す は mode に関係なく human', () => {
  assert.equal(decideImportAction({ verdict: '人に回す', mode: 'approval', safety: { ok: true } }), 'human');
  assert.equal(decideImportAction({ verdict: '人に回す', mode: 'auto', safety: { ok: true } }), 'human');
});

test('decideImportAction: mode=approval は安全確認の結果に関わらず承認待ち', () => {
  assert.equal(decideImportAction({ verdict: '返信', mode: 'approval', safety: { ok: true } }), 'await_approval');
  assert.equal(decideImportAction({ verdict: '返信', mode: 'approval', safety: { ok: false } }), 'await_approval');
});

test('decideImportAction: mode=auto は安全確認を通れば send、通らなければ hold', () => {
  assert.equal(decideImportAction({ verdict: '返信', mode: 'auto', safety: { ok: true } }), 'send');
  assert.equal(decideImportAction({ verdict: '返信', mode: 'auto', safety: { ok: false } }), 'hold');
});

test('initialDraftStatus: send は送信結果が出るまで承認待ちを経由せず送信保留', () => {
  assert.equal(initialDraftStatus('human'), DRAFT_STATUS.HUMAN);
  assert.equal(initialDraftStatus('await_approval'), DRAFT_STATUS.WAITING_APPROVAL);
  assert.equal(initialDraftStatus('send'), DRAFT_STATUS.HELD);
  assert.equal(initialDraftStatus('hold'), DRAFT_STATUS.HELD);
  assert.throws(() => initialDraftStatus('x'));
});

test('buildDraftRow: 返信案タブの列順に並ぶ', () => {
  const row = buildDraftRow({
    number: 3,
    draft: { eventId: 'e1', groupId: 'C1', company: 'A社', received: 'q', reply: 'r', verdict: '返信', reason: '' },
    status: DRAFT_STATUS.WAITING_APPROVAL,
    createdAt: '2026-09-30 10:00:00',
    source: 'LINE返信案_20260930-1000',
  });
  assert.equal(row.length, DRAFTS.headers.length);
  assert.equal(row[columnIndex(DRAFTS, '番号')], 3);
  assert.equal(row[columnIndex(DRAFTS, 'webhookEventId')], 'e1');
  assert.equal(row[columnIndex(DRAFTS, '状態')], '承認待ち');
  assert.equal(row[columnIndex(DRAFTS, '承認日時')], '');
  assert.equal(row[columnIndex(DRAFTS, '取込元')], 'LINE返信案_20260930-1000');
});

test('parseDraftRecords / nextDraftNumber / findDraftByNumber', () => {
  const mk = (n, status) => {
    const r = buildDraftRow({
      number: n,
      draft: { eventId: `e${n}`, groupId: 'C1', company: 'A社', received: 'q', reply: 'r', verdict: '返信', reason: '' },
      status,
      createdAt: '',
      source: '',
    });
    return r;
  };
  const rows = [mk(1, '送信済'), ['', '', '', '', '', '', '', '', '', '', '', '', ''], mk(5, '承認待ち'), ['abc']];
  const records = parseDraftRecords(rows);
  assert.deepEqual(records.map((r) => [r.rowIndex, r.number, r.status]), [[0, 1, '送信済'], [2, 5, '承認待ち']]);
  assert.equal(nextDraftNumber(records), 6);
  assert.equal(nextDraftNumber([]), 1);
  assert.equal(findDraftByNumber(records, 5).eventId, 'e5');
  assert.equal(findDraftByNumber(records, 2), null);
});
