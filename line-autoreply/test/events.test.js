import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CELL_CHARS,
  describeMessage,
  eventToRow,
  parseWebhookBody,
  sanitizeCell,
} from '../lib/events.js';
import { CONVERSATION_LOG, STATUS, columnIndex } from '../lib/schema.js';

const RECEIVED_AT = new Date('2026-09-29T00:00:00Z'); // JST 09:00:00
const col = (name) => columnIndex(CONVERSATION_LOG, name);

function textEvent(overrides = {}) {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.UTC(2026, 8, 28, 23, 59, 30), // JST 2026-09-29 08:59:30
    source: { type: 'group', groupId: 'Cgroup1', userId: 'Uuser1' },
    webhookEventId: '01HXXXXXXXXXXXXXXXXXXXXXXX',
    deliveryContext: { isRedelivery: false },
    replyToken: 'rt-1',
    message: { id: 'm1', type: 'text', text: 'こんにちは' },
    ...overrides,
  };
}

test('parseWebhookBody: 通常のボディ', () => {
  const r = parseWebhookBody(JSON.stringify({ destination: 'Ubot', events: [textEvent()] }));
  assert.equal(r.destination, 'Ubot');
  assert.equal(r.events.length, 1);
});

test('parseWebhookBody: 検証ボタン (events 空) は正常', () => {
  const r = parseWebhookBody(JSON.stringify({ destination: 'Ubot', events: [] }));
  assert.deepEqual(r.events, []);
});

test('parseWebhookBody: 不正な入力は例外', () => {
  assert.throws(() => parseWebhookBody(''), /空/);
  assert.throws(() => parseWebhookBody('not json'), /JSON/);
  assert.throws(() => parseWebhookBody('[]'), /オブジェクト/);
  assert.throws(() => parseWebhookBody('{"events":"x"}'), /配列/);
  assert.throws(() => parseWebhookBody('{"events":[{"type":1}]}'), /不正な要素/);
  assert.throws(() => parseWebhookBody('{"events":[null]}'), /不正な要素/);
});

test('eventToRow: テキストメッセージが見出し順に並ぶ', () => {
  const row = eventToRow(textEvent(), RECEIVED_AT);
  assert.equal(row.length, CONVERSATION_LOG.headers.length);
  assert.equal(row[col('受信日時')], '2026-09-29 09:00:00');
  assert.equal(row[col('イベント種別')], 'message');
  assert.equal(row[col('ソース種別')], 'group');
  assert.equal(row[col('グループID')], 'Cgroup1');
  assert.equal(row[col('ユーザーID')], 'Uuser1');
  assert.equal(row[col('メッセージ種別')], 'text');
  assert.equal(row[col('本文')], 'こんにちは');
  assert.equal(row[col('replyToken')], 'rt-1');
  assert.equal(row[col('状態')], STATUS.PENDING);
  assert.equal(row[col('webhookEventId')], '01HXXXXXXXXXXXXXXXXXXXXXXX');
  assert.equal(row[col('再送')], false);
  assert.equal(row[col('LINEタイムスタンプ')], '2026-09-29 08:59:30');
  assert.equal(row[col('処理日時')], '');
  assert.equal(row[col('処理メモ')], '');
  assert.deepEqual(JSON.parse(String(row[col('生データ')])), textEvent());
});

test('eventToRow: 1 対 1 (user) では グループID が空', () => {
  const row = eventToRow(textEvent({ source: { type: 'user', userId: 'Uadmin' } }), RECEIVED_AT);
  assert.equal(row[col('ソース種別')], 'user');
  assert.equal(row[col('グループID')], '');
  assert.equal(row[col('ユーザーID')], 'Uadmin');
});

test('eventToRow: room は roomId を グループID 列に入れる', () => {
  const row = eventToRow(textEvent({ source: { type: 'room', roomId: 'Rroom1', userId: 'U1' } }), RECEIVED_AT);
  assert.equal(row[col('グループID')], 'Rroom1');
});

test('eventToRow: join / leave / memberJoined / memberLeft も行になる', () => {
  const join = eventToRow(
    { type: 'join', timestamp: 0, source: { type: 'group', groupId: 'C1' }, replyToken: 'rt' },
    RECEIVED_AT,
  );
  assert.equal(join[col('イベント種別')], 'join');
  assert.equal(join[col('本文')], '[グループに参加]');
  assert.equal(join[col('メッセージ種別')], '');
  assert.equal(join[col('状態')], STATUS.PENDING);

  const leave = eventToRow({ type: 'leave', source: { type: 'group', groupId: 'C1' } }, RECEIVED_AT);
  assert.equal(leave[col('本文')], '[グループから退出]');
  assert.equal(leave[col('replyToken')], '');
  assert.equal(leave[col('LINEタイムスタンプ')], '');

  const joined = eventToRow(
    { type: 'memberJoined', source: { type: 'group', groupId: 'C1' }, joined: { members: [{ type: 'user', userId: 'Ua' }, { type: 'user', userId: 'Ub' }] } },
    RECEIVED_AT,
  );
  assert.equal(joined[col('本文')], '[メンバー参加 Ua,Ub]');

  const left = eventToRow(
    { type: 'memberLeft', source: { type: 'group', groupId: 'C1' }, left: { members: [{ type: 'user', userId: 'Ua' }] } },
    RECEIVED_AT,
  );
  assert.equal(left[col('本文')], '[メンバー退出 Ua]');
});

test('eventToRow: follow / unfollow / postback / unsend / 未知イベント', () => {
  const mk = (ev) => eventToRow({ source: { type: 'user', userId: 'U' }, ...ev }, RECEIVED_AT)[col('本文')];
  assert.equal(mk({ type: 'follow' }), '[友だち追加]');
  assert.equal(mk({ type: 'unfollow' }), '[ブロック]');
  assert.equal(mk({ type: 'postback', postback: { data: 'action=ok&id=1' } }), '[postback action=ok&id=1]');
  assert.equal(mk({ type: 'unsend', unsend: { messageId: 'm9' } }), '[送信取消 messageId=m9]');
  assert.equal(mk({ type: 'somethingNew' }), '[somethingNew]');
});

test('eventToRow: 再送フラグと source 欠落に耐える', () => {
  const row = eventToRow({ type: 'message', message: { type: 'text', text: 'x' }, deliveryContext: { isRedelivery: true } }, RECEIVED_AT);
  assert.equal(row[col('再送')], true);
  assert.equal(row[col('ソース種別')], '');
  assert.equal(row[col('グループID')], '');
});

test('describeMessage: テキスト以外は種別と ID を残す', () => {
  assert.equal(describeMessage({ type: 'sticker', packageId: '1', stickerId: '2' }), '[スタンプ packageId=1 stickerId=2]');
  assert.equal(describeMessage({ type: 'image', id: 'i1' }), '[画像 id=i1]');
  assert.equal(describeMessage({ type: 'video', id: 'v1' }), '[動画 id=v1]');
  assert.equal(describeMessage({ type: 'audio', id: 'a1' }), '[音声 id=a1]');
  assert.equal(describeMessage({ type: 'file', id: 'f1', fileName: '見積.pdf' }), '[ファイル 見積.pdf id=f1]');
  assert.equal(describeMessage({ type: 'location', title: '本社', address: '東京都' }), '[位置情報 本社 東京都]');
  assert.equal(describeMessage({ type: 'weird', id: 'w' }), '[weird id=w]');
  assert.equal(describeMessage({ type: 'text' }), '');
  assert.equal(describeMessage(undefined), '');
});

test('sanitizeCell: 数式として解釈される先頭文字を無害化する', () => {
  assert.equal(sanitizeCell('=IMPORTRANGE("x")'), "'=IMPORTRANGE(\"x\")");
  assert.equal(sanitizeCell('+1'), "'+1");
  assert.equal(sanitizeCell('-1'), "'-1");
  assert.equal(sanitizeCell('@foo'), "'@foo");
  assert.equal(sanitizeCell('普通の文'), '普通の文');
  assert.equal(sanitizeCell(null), '');
  assert.equal(sanitizeCell(undefined), '');
  assert.equal(sanitizeCell(3), 3);
  assert.equal(sanitizeCell(true), true);
});

test('sanitizeCell: 長すぎる文字列は切り詰める', () => {
  const long = 'あ'.repeat(MAX_CELL_CHARS + 100);
  const out = String(sanitizeCell(long));
  assert.ok(out.length < MAX_CELL_CHARS + 20);
  assert.ok(out.endsWith('(切り詰め)'));
});

test('eventToRow: 数式注入を含む本文も文字列として記録される', () => {
  const row = eventToRow(textEvent({ message: { id: 'm', type: 'text', text: '=HYPERLINK("http://x")' } }), RECEIVED_AT);
  assert.equal(String(row[col('本文')]).startsWith("'="), true);
  assert.equal(String(row[col('生データ')]).startsWith('{'), true);
});
