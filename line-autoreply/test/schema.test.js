import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SHEETS,
  CONVERSATION_LOG,
  DEFAULT_AUTO_REGISTER_EXCLUDE,
  DEFAULT_MODE,
  DRAFTS,
  DRAFT_FILE_HEADERS,
  IMPORTED,
  LEDGER,
  MODES,
  OPS_LOG,
  SETTINGS,
  SETTING_KEYS,
  columnIndex,
} from '../lib/schema.js';
import { formatJst } from '../lib/time.js';

test('シート名は仕様どおり 6 枚 (第 1 歩の 4 枚 + 返信案 + 取込済)', () => {
  assert.deepEqual(
    ALL_SHEETS.map((s) => s.name),
    ['会話ログ', '取引先台帳', '設定', '稼働ログ', '返信案', '取込済'],
  );
});

test('会話ログの列の並びは第 1 歩から変えず、第 3 歩の 送信者名 は末尾に足す (既存列の添字を壊さない)', () => {
  assert.deepEqual(
    [...CONVERSATION_LOG.headers],
    ['受信日時', 'イベント種別', 'ソース種別', 'グループID', 'ユーザーID', 'メッセージ種別', '本文', 'replyToken', '状態', 'webhookEventId', '再送', 'LINEタイムスタンプ', '処理日時', '処理メモ', '生データ', '送信者名'],
  );
  assert.equal(columnIndex(CONVERSATION_LOG, '生データ'), 14);
  assert.equal(columnIndex(CONVERSATION_LOG, '送信者名'), 15);
});

test('自動登録の除外: 全体連絡用グループはコード側で常に除外、設定キーで追加できる', () => {
  assert.deepEqual([...DEFAULT_AUTO_REGISTER_EXCLUDE], ['Cab4b7bb74101992bc1f9efc7d2fc7dde']);
  assert.equal(SETTING_KEYS.AUTO_REGISTER_EXCLUDE, 'auto_register_exclude');
  assert.equal(SETTINGS.initialRows[1][0], 'auto_register_exclude');
});

test('返信案タブと返信案ファイルの見出し', () => {
  assert.deepEqual(
    [...DRAFTS.headers],
    ['番号', 'webhookEventId', 'グループID', '会社名', '受信本文', '返信案', '判定', '理由', '状態', '作成日時', '承認日時', '送信結果', '取込元'],
  );
  assert.deepEqual([...DRAFT_FILE_HEADERS], ['webhookEventId', 'グループID', '会社名', '受信本文', '返信案', '判定', '理由']);
  assert.deepEqual([...IMPORTED.headers].slice(0, 3), ['ファイルID', 'ファイル名', '取込日時']);
});

test('会話ログの見出しに必須列がある', () => {
  for (const h of ['受信日時', 'イベント種別', 'グループID', 'ユーザーID', 'メッセージ種別', '本文', 'replyToken', '状態']) {
    assert.ok(CONVERSATION_LOG.headers.includes(h), h);
  }
});

test('取引先台帳の見出しにグループID・会社名・共有先・区分がある', () => {
  for (const h of ['グループID', '会社名', '区分', '共有スプレッドシートID', '共有フォルダID']) {
    assert.ok(LEDGER.headers.includes(h), h);
  }
});

test('設定シートの初期行は mode=approval', () => {
  assert.deepEqual(SETTINGS.headers, ['キー', '値', '説明']);
  assert.equal(SETTINGS.initialRows[0][0], 'mode');
  assert.equal(SETTINGS.initialRows[0][1], 'approval');
  assert.equal(DEFAULT_MODE, 'approval');
  assert.deepEqual([...MODES], ['approval', 'auto']);
});

test('稼働ログの見出し', () => {
  assert.deepEqual([...OPS_LOG.headers], ['日時', 'レベル', '処理', 'グループID', '内容']);
});

test('見出しに重複がない', () => {
  for (const def of ALL_SHEETS) {
    assert.equal(new Set(def.headers).size, def.headers.length, def.name);
  }
});

test('columnIndex: 0 始まりで返し、無い見出しは例外', () => {
  assert.equal(columnIndex(CONVERSATION_LOG, '受信日時'), 0);
  assert.equal(columnIndex(CONVERSATION_LOG, '状態'), 8);
  assert.throws(() => columnIndex(CONVERSATION_LOG, '存在しない'), /見出し/);
});

test('formatJst: UTC → JST 表記、日付跨ぎ、不正値は空', () => {
  assert.equal(formatJst(new Date('2026-09-28T15:00:00Z')), '2026-09-29 00:00:00');
  assert.equal(formatJst(Date.UTC(2026, 0, 1, 0, 5, 9)), '2026-01-01 09:05:09');
  assert.equal(formatJst('2026-12-31T23:30:00Z'), '2027-01-01 08:30:00');
  assert.equal(formatJst('not a date'), '');
  assert.equal(formatJst(NaN), '');
});
