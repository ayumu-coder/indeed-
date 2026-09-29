import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPendingRowIndexes, parseSettings, resolveMode } from '../lib/queue.js';
import { STATUS } from '../lib/schema.js';

test('parseSettings: キー→値。空キー無視、trim、後勝ち', () => {
  const s = parseSettings([
    ['mode', ' approval ', '説明'],
    ['', 'ignored'],
    [null, 'ignored'],
    ['mode', 'auto'],
    ['other', 42],
  ]);
  assert.deepEqual(s, { mode: 'auto', other: '42' });
});

test('resolveMode: approval / auto を受け付け、大文字も許容', () => {
  assert.deepEqual(resolveMode({ mode: 'approval' }), { mode: 'approval', warning: null });
  assert.deepEqual(resolveMode({ mode: 'auto' }), { mode: 'auto', warning: null });
  assert.deepEqual(resolveMode({ mode: 'AUTO' }), { mode: 'auto', warning: null });
});

test('resolveMode: 未設定・不正値は approval に倒して警告を返す', () => {
  const missing = resolveMode({});
  assert.equal(missing.mode, 'approval');
  assert.match(missing.warning, /未設定/);

  const bad = resolveMode({ mode: 'yes' });
  assert.equal(bad.mode, 'approval');
  assert.match(bad.warning, /不正/);
});

test('findPendingRowIndexes: 未処理のみ、古い順、上限あり', () => {
  const rows = [
    ['a', STATUS.DONE],
    ['b', STATUS.PENDING],
    ['c', STATUS.ERROR],
    ['d', STATUS.PENDING],
    ['e', STATUS.PENDING],
    ['f', ''],
  ];
  assert.deepEqual(findPendingRowIndexes(rows, 1, 10), [1, 3, 4]);
  assert.deepEqual(findPendingRowIndexes(rows, 1, 2), [1, 3]);
  assert.deepEqual(findPendingRowIndexes([], 1, 2), []);
});

test('findPendingRowIndexes: limit が不正なら例外', () => {
  assert.throws(() => findPendingRowIndexes([], 1, 0));
  assert.throws(() => findPendingRowIndexes([], 1, 1.5));
});
