import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_REASON, isSendableClient, isTruthyFlag, parseLedger, rowToEventInfo, triageEvent } from '../lib/ledger.js';
import { CONVERSATION_LOG, LEDGER_KIND, columnIndex } from '../lib/schema.js';
import { eventToRow } from '../lib/events.js';

const ADMIN = 'Uadmin';

/** 台帳行: グループID, 会社名, グループ名, 区分, 共有SS, 共有Folder, 担当者, 有効, 備考 */
const LEDGER_ROWS = [
  ['Cclient', '株式会社サンプル商事', 'サンプル商事×当社', LEDGER_KIND.CLIENT, 'ss1', 'f1', '山田', true, ''],
  ['Cclient2', '合同会社テスト工業', 'テスト工業', LEDGER_KIND.CLIENT, '', '', '佐藤', 'TRUE', ''],
  ['Cinternal', '当社', '社内連絡', LEDGER_KIND.INTERNAL, '', '', '', true, ''],
  ['Cdisabled', '株式会社停止中', '停止中', LEDGER_KIND.CLIENT, '', '', '', false, '一時停止'],
  ['Cweird', '区分不明社', '不明', 'その他', '', '', '', true, ''],
  ['', '空ID行は無視', '', LEDGER_KIND.CLIENT, '', '', '', true, ''],
];

function ledger() {
  return parseLedger(LEDGER_ROWS);
}

function groupText(groupId, text, extra = {}) {
  return { eventType: 'message', sourceType: 'group', groupId, userId: 'Usomeone', messageType: 'text', text, ...extra };
}

test('isTruthyFlag: boolean true と文字列 TRUE (大小・空白を許容) だけ真', () => {
  assert.equal(isTruthyFlag(true), true);
  assert.equal(isTruthyFlag('TRUE'), true);
  assert.equal(isTruthyFlag(' true '), true);
  assert.equal(isTruthyFlag(false), false);
  assert.equal(isTruthyFlag('FALSE'), false);
  assert.equal(isTruthyFlag(''), false);
  assert.equal(isTruthyFlag(1), false);
  assert.equal(isTruthyFlag(null), false);
});

test('parseLedger: グループID をキーにし、空 ID を無視、有効を真偽に丸める', () => {
  const m = ledger();
  assert.equal(m.size, 5);
  const c = m.get('Cclient');
  assert.equal(c.company, '株式会社サンプル商事');
  assert.equal(c.contact, '山田');
  assert.equal(c.kind, '取引先');
  assert.equal(c.enabled, true);
  assert.equal(m.get('Cclient2').enabled, true);
  assert.equal(m.get('Cdisabled').enabled, false);
  assert.equal(m.get('Cdisabled').note, '一時停止');
});

test('parseLedger: 同じグループID は後勝ち', () => {
  const m = parseLedger([
    ['C1', '旧社名', '', LEDGER_KIND.CLIENT, '', '', '', true, ''],
    ['C1', '新社名', '', LEDGER_KIND.CLIENT, '', '', '', true, ''],
  ]);
  assert.equal(m.get('C1').company, '新社名');
});

test('isSendableClient: 取引先かつ有効のみ真', () => {
  const m = ledger();
  assert.equal(isSendableClient(m.get('Cclient')), true);
  assert.equal(isSendableClient(m.get('Cinternal')), false);
  assert.equal(isSendableClient(m.get('Cdisabled')), false);
  assert.equal(isSendableClient(m.get('Cweird')), false);
  assert.equal(isSendableClient(undefined), false);
});

test('triageEvent: 取引先かつ有効のテキスト message → 返信案待ち', () => {
  const t = triageEvent(groupText('Cclient', '納期を教えてください'), ledger(), ADMIN);
  assert.equal(t.kind, 'await_draft');
  assert.equal(t.entry.company, '株式会社サンプル商事');
});

test('triageEvent: 社内 / 未登録 / 無効 / 区分不明 → 対象外', () => {
  const m = ledger();
  assert.deepEqual(triageEvent(groupText('Cinternal', 'hi'), m, ADMIN), { kind: 'skip', memo: SKIP_REASON.INTERNAL });
  assert.deepEqual(triageEvent(groupText('Cnotfound', 'hi'), m, ADMIN), { kind: 'skip', memo: SKIP_REASON.UNREGISTERED });
  assert.deepEqual(triageEvent(groupText('Cdisabled', 'hi'), m, ADMIN), { kind: 'skip', memo: SKIP_REASON.DISABLED });
  assert.deepEqual(triageEvent(groupText('Cweird', 'hi'), m, ADMIN), { kind: 'skip', memo: SKIP_REASON.UNKNOWN_KIND });
});

test('triageEvent: 取引先でも join / スタンプ / 空本文 は対象外', () => {
  const m = ledger();
  assert.deepEqual(triageEvent(groupText('Cclient', '[グループに参加]', { eventType: 'join', messageType: '' }), m, ADMIN), {
    kind: 'skip',
    memo: SKIP_REASON.NOT_MESSAGE,
  });
  assert.deepEqual(triageEvent(groupText('Cclient', '[スタンプ]', { messageType: 'sticker' }), m, ADMIN), {
    kind: 'skip',
    memo: SKIP_REASON.NOT_TEXT,
  });
  assert.deepEqual(triageEvent(groupText('Cclient', '   '), m, ADMIN), { kind: 'skip', memo: SKIP_REASON.EMPTY_TEXT });
});

test('triageEvent: 管理者からの 1 対 1 テキストは承認コマンド、他人・非テキストは対象外', () => {
  const m = ledger();
  const admin = { eventType: 'message', sourceType: 'user', groupId: '', userId: ADMIN, messageType: 'text', text: 'OK 3' };
  assert.deepEqual(triageEvent(admin, m, ADMIN), { kind: 'admin_command', text: 'OK 3' });
  assert.deepEqual(triageEvent({ ...admin, userId: 'Uother' }, m, ADMIN), { kind: 'skip', memo: SKIP_REASON.DIRECT_NOT_ADMIN });
  assert.deepEqual(triageEvent({ ...admin, messageType: 'sticker' }, m, ADMIN), { kind: 'skip', memo: SKIP_REASON.DIRECT_NOT_TEXT });
  assert.deepEqual(triageEvent({ ...admin, eventType: 'follow', messageType: '' }, m, ADMIN), {
    kind: 'skip',
    memo: SKIP_REASON.DIRECT_NOT_TEXT,
  });
});

test('triageEvent: ADMIN_USER_ID 未設定なら 1 対 1 は全部対象外 (誰もコマンドを打てない)', () => {
  const admin = { eventType: 'message', sourceType: 'user', groupId: '', userId: ADMIN, messageType: 'text', text: 'OK 3' };
  assert.equal(triageEvent(admin, ledger(), '').kind, 'skip');
  assert.equal(triageEvent(admin, ledger(), null).kind, 'skip');
});

test('rowToEventInfo: eventToRow が作った行から復元できる', () => {
  const ev = {
    type: 'message',
    source: { type: 'group', groupId: 'Cclient', userId: 'U1' },
    message: { type: 'text', text: '見積の件です' },
    webhookEventId: 'evt1',
  };
  const row = eventToRow(ev, new Date(0));
  const info = rowToEventInfo(row);
  assert.deepEqual(info, {
    eventType: 'message',
    sourceType: 'group',
    groupId: 'Cclient',
    userId: 'U1',
    messageType: 'text',
    text: '見積の件です',
  });
  assert.equal(row[columnIndex(CONVERSATION_LOG, 'webhookEventId')], 'evt1');
  assert.equal(triageEvent(info, ledger(), ADMIN).kind, 'await_draft');
});
