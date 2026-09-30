import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAME_MAX_CHARS,
  SENDER_NAME_CACHE_SECONDS,
  buildAutoLedgerRow,
  findUnregisteredGroupIds,
  formatAutoRegisterNote,
  needsSenderName,
  pickName,
  resolveAutoRegisterExclude,
  senderCacheKey,
  shouldAutoRegisterOnJoin,
} from '../lib/groups.js';
import { LEDGER, LEDGER_KIND, columnIndex } from '../lib/schema.js';
import { parseLedger } from '../lib/ledger.js';
import { eventToRow } from '../lib/events.js';

const QUAD_ALL = 'Cab4b7bb74101992bc1f9efc7d2fc7dde';

test('resolveAutoRegisterExclude: 全体連絡用は常に含み、設定のカンマ・空白・読点区切りを足す', () => {
  assert.deepEqual([...resolveAutoRegisterExclude({})], [QUAD_ALL]);
  assert.deepEqual([...resolveAutoRegisterExclude({ auto_register_exclude: 'C1, C2　C3、C1' })], [QUAD_ALL, 'C1', 'C2', 'C3']);
  assert.deepEqual([...resolveAutoRegisterExclude(undefined)], [QUAD_ALL]);
});

test('formatAutoRegisterNote: 「自動登録 YYYY-MM-DD HH:mm」(JST、秒なし)', () => {
  assert.equal(formatAutoRegisterNote(new Date('2026-09-30T01:02:03Z')), '自動登録 2026-09-30 10:02');
});

test('pickName: 文字列のみ採用、trim、長すぎれば切る、無ければ空', () => {
  assert.equal(pickName({ groupName: ' 株式会社A × Quad ' }, 'groupName'), '株式会社A × Quad');
  assert.equal(pickName({ displayName: '山田' }, 'displayName'), '山田');
  assert.equal(pickName({ groupName: 123 }, 'groupName'), '');
  assert.equal(pickName(null, 'groupName'), '');
  assert.equal(pickName('str', 'groupName'), '');
  const long = pickName({ groupName: 'あ'.repeat(NAME_MAX_CHARS + 5) }, 'groupName');
  assert.equal(Array.from(long).length, NAME_MAX_CHARS + 1);
  assert.ok(long.endsWith('…'));
});

test('senderCacheKey: (groupId, userId) ごとに一意。キャッシュ期間は 6 時間', () => {
  assert.equal(senderCacheKey('C1', 'U1'), 'sender:C1:U1');
  assert.notEqual(senderCacheKey('C1', 'U2'), senderCacheKey('C1', 'U1'));
  assert.equal(SENDER_NAME_CACHE_SECONDS, 21600);
});

test('buildAutoLedgerRow: 会社名=グループ名=取得した名前、区分=取引先、有効=TRUE、備考=自動登録、共有先・担当者は空', () => {
  const row = buildAutoLedgerRow({ groupId: 'Cnew', groupName: '株式会社新規', registeredAt: new Date('2026-09-30T01:02:03Z') });
  assert.equal(row.length, LEDGER.headers.length);
  const get = (h) => row[columnIndex(LEDGER, h)];
  assert.equal(get('グループID'), 'Cnew');
  assert.equal(get('会社名'), '株式会社新規');
  assert.equal(get('グループ名'), '株式会社新規');
  assert.equal(get('区分'), LEDGER_KIND.CLIENT);
  assert.equal(get('共有スプレッドシートID'), '');
  assert.equal(get('共有フォルダID'), '');
  assert.equal(get('担当者'), '');
  assert.equal(get('有効'), true);
  assert.equal(get('備考'), '自動登録 2026-09-30 10:02');

  // parseLedger で読み戻すと 取引先 かつ 有効 (返信対象) になる。名前が空でも登録自体はできる
  const entry = parseLedger([buildAutoLedgerRow({ groupId: 'Cnew', groupName: '', registeredAt: new Date(0) })]).get('Cnew');
  assert.equal(entry.company, '');
  assert.equal(entry.kind, LEDGER_KIND.CLIENT);
  assert.equal(entry.enabled, true);
});

test('shouldAutoRegisterOnJoin: グループ発 join で台帳・除外に無いときだけ真', () => {
  const ledger = parseLedger([['Cknown', 'A社', '', LEDGER_KIND.CLIENT, '', '', '', true, '']]);
  const exclude = new Set([QUAD_ALL]);
  const join = (groupId, extra = {}) => ({ eventType: 'join', sourceType: 'group', groupId, userId: '', messageType: '', text: '', ...extra });
  assert.equal(shouldAutoRegisterOnJoin(join('Cnew'), ledger, exclude), true);
  assert.equal(shouldAutoRegisterOnJoin(join('Cknown'), ledger, exclude), false);
  assert.equal(shouldAutoRegisterOnJoin(join(QUAD_ALL), ledger, exclude), false);
  assert.equal(shouldAutoRegisterOnJoin(join('Rroom', { sourceType: 'room' }), ledger, exclude), false);
  assert.equal(shouldAutoRegisterOnJoin(join('Cnew', { eventType: 'memberJoined' }), ledger, exclude), false);
  assert.equal(shouldAutoRegisterOnJoin(join('Cnew', { eventType: 'leave' }), ledger, exclude), false);
  assert.equal(shouldAutoRegisterOnJoin(join(''), ledger, exclude), false);
});

test('findUnregisteredGroupIds: 会話ログの初出順、台帳済・除外・最後が leave のグループは除く', () => {
  const at = new Date(0);
  const ev = (type, groupId, extra = {}) => eventToRow({ type, source: { type: 'group', groupId, userId: 'U' }, ...extra }, at);
  const rows = [
    ev('join', 'Cb'),
    ev('join', 'Ca'),
    ev('message', 'Ca', { message: { type: 'text', text: 'hi' } }),
    ev('join', 'Cleft'),
    ev('leave', 'Cleft'),
    ev('join', 'Crejoined'),
    ev('leave', 'Crejoined'),
    ev('join', 'Crejoined'),
    ev('join', 'Cknown'),
    ev('join', QUAD_ALL),
    eventToRow({ type: 'message', source: { type: 'user', userId: 'Uadmin' }, message: { type: 'text', text: 'OK 1' } }, at),
    eventToRow({ type: 'join', source: { type: 'room', roomId: 'Rroom' } }, at),
  ];
  const ledger = parseLedger([['Cknown', 'A社', '', LEDGER_KIND.CLIENT, '', '', '', true, '']]);
  assert.deepEqual(findUnregisteredGroupIds(rows, ledger, new Set([QUAD_ALL])), ['Cb', 'Ca', 'Crejoined']);
  assert.deepEqual(findUnregisteredGroupIds([], ledger, new Set()), []);
});

test('needsSenderName: グループ発 message で userId があるときだけ真', () => {
  const info = { eventType: 'message', sourceType: 'group', groupId: 'C1', userId: 'U1', messageType: 'sticker', text: '' };
  assert.equal(needsSenderName(info), true);
  assert.equal(needsSenderName({ ...info, userId: '' }), false);
  assert.equal(needsSenderName({ ...info, sourceType: 'user', groupId: '' }), false);
  assert.equal(needsSenderName({ ...info, eventType: 'memberJoined' }), false);
});
