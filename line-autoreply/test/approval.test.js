import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovalRequestText,
  buildHoldNoticeText,
  buildHumanNoticeText,
  buildNoMatchText,
  checkSendSafety,
  normalizeCommandText,
  parseApprovalCommand,
  truncateText,
} from '../lib/approval.js';
import { parseLedger } from '../lib/ledger.js';
import { LEDGER_KIND } from '../lib/schema.js';

const ledger = parseLedger([
  ['Cclient', '株式会社サンプル商事', '', LEDGER_KIND.CLIENT, '', '', '山田', true, ''],
  ['Cclient2', '合同会社テスト工業', '', LEDGER_KIND.CLIENT, '', '', '佐藤', true, ''],
  ['Cclient3', '株式会社サンプル商事', '', LEDGER_KIND.CLIENT, '', '', '山田', true, '同じ会社の別グループ'],
  ['Cinternal', '当社', '', LEDGER_KIND.INTERNAL, '', '', '', true, ''],
  ['Cdisabled', '株式会社停止中', '', LEDGER_KIND.CLIENT, '', '', '', false, ''],
]);

test('parseApprovalCommand: 半角の基本形', () => {
  assert.deepEqual(parseApprovalCommand('OK 12'), { action: 'approve', number: 12 });
  assert.deepEqual(parseApprovalCommand('却下 12'), { action: 'reject', number: 12 });
});

test('parseApprovalCommand: 全角英数・全角空白・大小・# の揺れを吸収', () => {
  assert.deepEqual(parseApprovalCommand('ＯＫ　１２'), { action: 'approve', number: 12 });
  assert.deepEqual(parseApprovalCommand('ok12'), { action: 'approve', number: 12 });
  assert.deepEqual(parseApprovalCommand('  Ok   #7 '), { action: 'approve', number: 7 });
  assert.deepEqual(parseApprovalCommand('却下　＃３'), { action: 'reject', number: 3 });
  assert.deepEqual(parseApprovalCommand('却下3'), { action: 'reject', number: 3 });
  assert.deepEqual(parseApprovalCommand('OK　3'), { action: 'approve', number: 3 });
});

test('parseApprovalCommand: コマンドでない文は null', () => {
  for (const t of ['', null, undefined, 'OK', '12', 'OKです 12', 'OK 12 お願いします', '却下理由 12', 'ok 1a', 'okay 3', 'OK 12 13']) {
    assert.equal(parseApprovalCommand(t), null, JSON.stringify(t));
  }
});

test('normalizeCommandText / truncateText', () => {
  assert.equal(normalizeCommandText('　ＡＢＣ　　ｄ　'), 'ABC d');
  assert.equal(truncateText('あいうえお', 3), 'あいう…');
  assert.equal(truncateText('あいう', 3), 'あいう');
  assert.equal(truncateText(null, 3), '');
});

test('checkSendSafety: 問題なければ ok', () => {
  const r = checkSendSafety({ text: '山田です。納期は来週金曜を予定しております。よろしくお願いいたします。', groupId: 'Cclient', ledger });
  assert.deepEqual(r, { ok: true, reasons: [] });
});

test('checkSendSafety: 円 / ¥ / ￥ / 万円 を含むと保留', () => {
  for (const text of ['単価は 1,000円です', '¥500 になります', '￥500', '約 3万円']) {
    const r = checkSendSafety({ text, groupId: 'Cclient', ledger });
    assert.equal(r.ok, false, text);
    assert.ok(r.reasons.some((x) => x.startsWith('金額表現')), r.reasons.join());
  }
});

test('checkSendSafety: 他社 (区分=取引先で会社名が異なる) の名前を含むと保留', () => {
  const r = checkSendSafety({ text: '合同会社テスト工業さんと同じ条件です', groupId: 'Cclient', ledger });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['他社名「合同会社テスト工業」を含む']);
});

test('checkSendSafety: 自社名 (送信先の会社名) と社内グループの名前は他社扱いしない', () => {
  const own = checkSendSafety({ text: '株式会社サンプル商事 御中', groupId: 'Cclient', ledger });
  assert.equal(own.ok, true);
  const internal = checkSendSafety({ text: '当社で確認して折り返します', groupId: 'Cclient', ledger });
  assert.equal(internal.ok, true);
});

test('checkSendSafety: 送信先が未登録 / 社内 / 無効 なら保留', () => {
  assert.deepEqual(checkSendSafety({ text: 'ok', groupId: 'Cnone', ledger }).reasons, ['送信先グループが台帳に未登録']);
  assert.deepEqual(checkSendSafety({ text: 'ok', groupId: 'Cinternal', ledger }).reasons, ['送信先の区分が取引先ではない (社内)']);
  assert.deepEqual(checkSendSafety({ text: 'ok', groupId: 'Cdisabled', ledger }).reasons, ['送信先グループが無効']);
});

test('checkSendSafety: 空本文は保留、複数の理由をすべて返す', () => {
  const r = checkSendSafety({ text: '', groupId: 'Cinternal', ledger });
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 2);
  const multi = checkSendSafety({ text: '合同会社テスト工業に 500円', groupId: 'Cnone', ledger });
  assert.equal(multi.reasons.length, 3);
});

test('buildApprovalRequestText: 指定の型、受信本文は 100 字で切る', () => {
  const long = 'あ'.repeat(150);
  const text = buildApprovalRequestText({ number: 5, company: '株式会社サンプル商事', received: long, reply: '返信です', reason: '' });
  const lines = text.split('\n');
  assert.equal(lines[0], '案 #5【株式会社サンプル商事】');
  assert.equal(lines[1], `受信: ${'あ'.repeat(100)}…`);
  assert.equal(lines[2], '返信案: 返信です');
  assert.equal(lines[3], '→ 送るなら『OK 5』、送らないなら『却下 5』');
});

test('buildApprovalRequestText / buildHumanNoticeText: 送信者名があれば「受信 (送信者名): …」にする', () => {
  const approval = buildApprovalRequestText({ number: 5, company: 'X社', received: '納期は', reply: 'r', reason: '', sender: '山田 太郎' });
  assert.equal(approval.split('\n')[1], '受信 (山田 太郎): 納期は');
  const human = buildHumanNoticeText({ number: 6, company: 'X社', received: 'q', reply: '', reason: 'z', sender: ' ' });
  assert.equal(human.split('\n')[1], '受信: q');
});

test('buildHumanNoticeText: OK/却下 の案内を含まない', () => {
  const text = buildHumanNoticeText({ number: 6, company: 'X社', received: '値引きできますか', reply: '', reason: '金額の話' });
  assert.equal(text, '人に回す #6【X社】\n受信: 値引きできますか\n理由: 金額の話');
  assert.ok(!text.includes('OK'));
});

test('buildHoldNoticeText / buildNoMatchText', () => {
  assert.match(buildHoldNoticeText({ number: 1, company: 'X社' }, ['a', 'b']), /^送信保留 #1【X社】\n理由: a \/ b/);
  assert.equal(buildNoMatchText({ action: 'approve', number: 9 }, null), '該当なし: #9 の返信案はありません (OK)');
  assert.equal(buildNoMatchText({ action: 'reject', number: 9 }, '送信済'), '該当なし: #9 は「送信済」のため 却下 できません');
});
