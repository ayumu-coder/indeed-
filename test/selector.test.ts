import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isSendableEmail, selectTargets, type SelectionOptions } from '../src/domain/selector.ts';
import type { SheetTable } from '../src/domain/types.ts';

const NOW = new Date('2026-09-07T02:00:00Z'); // 11:00 JST on 2026-09-07 → target day 2026-09-08

const HEADER = [
  '求人掲載企業', '応募日', '応募職種', '求職者名', '年齢', '担当者', 'メールアドレス',
  '電話番号', 'メール連絡', '2回目メール', '面接設定可否', '初回面接予定日', 'リマインド可否', '面接実施可否',
];

function row(overrides: Partial<Record<string, string>>): string[] {
  const values = HEADER.map((header) => overrides[header] ?? '');
  return values;
}

function table(rows: readonly (readonly string[])[]): SheetTable {
  return { sheetId: 1, title: '応募振り分け', rows: [HEADER, ...rows] };
}

const BASE: SelectionOptions = {
  now: NOW,
  offsetDays: 1,
  remindFlagMode: 'skipIfMarked',
  remindFlagAllowValues: ['実施'],
  interviewScheduledValues: ['設定済み'],
  alreadySent: new Set(),
};

const ELIGIBLE = {
  求人掲載企業: '株式会社EatLABO',
  応募職種: '《未経験》事務/仙台市',
  求職者名: '泉 琴音',
  担当者: '新田',
  メールアドレス: 'ktiz516buvzf_uvf@indeedemail.com',
  面接設定可否: '設定済み',
  初回面接予定日: '2026/09/08 0:00:00',
};

test('selects only interviews on the target day', () => {
  const result = selectTargets(
    [table([
      row(ELIGIBLE),
      row({ ...ELIGIBLE, 求職者名: '今日の人', 初回面接予定日: '2026/09/07 0:00:00' }),
      row({ ...ELIGIBLE, 求職者名: '明後日の人', 初回面接予定日: '2026/09/09 0:00:00' }),
    ])],
    BASE,
  );
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0]?.candidateName, '泉 琴音');
  assert.equal(result.targets[0]?.rowNumber, 2);
  assert.equal(result.targets[0]?.sheetId, 1);
});

test('offsetDays=0 targets today', () => {
  const result = selectTargets(
    [table([row({ ...ELIGIBLE, 初回面接予定日: '2026/09/07 0:00:00' })])],
    { ...BASE, offsetDays: 0 },
  );
  assert.equal(result.targets.length, 1);
});

test('skipIfMarked treats a non-empty リマインド可否 as already handled', () => {
  const result = selectTargets([table([row({ ...ELIGIBLE, リマインド可否: '実施' })])], BASE);
  assert.equal(result.targets.length, 0);
  assert.equal(result.skipped[0]?.reason, 'remind-flag-blocked');
});

test('requireMarked sends only rows carrying an allowed flag', () => {
  const options = { ...BASE, remindFlagMode: 'requireMarked' as const };
  assert.equal(selectTargets([table([row(ELIGIBLE)])], options).targets.length, 0);
  assert.equal(selectTargets([table([row({ ...ELIGIBLE, リマインド可否: '実施' })])], options).targets.length, 1);
});

test('ignore mode disregards the flag entirely', () => {
  const result = selectTargets(
    [table([row({ ...ELIGIBLE, リマインド可否: '実施' })])],
    { ...BASE, remindFlagMode: 'ignore' },
  );
  assert.equal(result.targets.length, 1);
});

test('requires the interview to be booked when 面接設定可否 is gated', () => {
  const result = selectTargets([table([row({ ...ELIGIBLE, 面接設定可否: '' })])], BASE);
  assert.equal(result.skipped[0]?.reason, 'interview-not-scheduled');
  const ungated = selectTargets([table([row({ ...ELIGIBLE, 面接設定可否: '' })])], {
    ...BASE,
    interviewScheduledValues: [],
  });
  assert.equal(ungated.targets.length, 1);
});

test('rejects malformed and missing addresses', () => {
  const bad = ['', 'not-an-email', 'a@b', 'a b@c.com', 'X <x@y.com>', 'a@c.com, b@c.com'];
  for (const email of bad) {
    const result = selectTargets([table([row({ ...ELIGIBLE, メールアドレス: email })])], BASE);
    assert.equal(result.targets.length, 0, `expected rejection for "${email}"`);
  }
  assert.equal(isSendableEmail('ktiz516buvzf_uvf@indeedemail.com'), true);
});

test('suppresses rows already recorded as sent, and duplicates within one batch', () => {
  const withLog = selectTargets([table([row(ELIGIBLE)])], {
    ...BASE,
    alreadySent: new Set(['ktiz516buvzf_uvf@indeedemail.com|2026-09-08|d-1']),
  });
  assert.equal(withLog.targets.length, 0);
  assert.equal(withLog.skipped[0]?.reason, 'already-sent');

  const duplicated = selectTargets([table([row(ELIGIBLE), row(ELIGIBLE)])], BASE);
  assert.equal(duplicated.targets.length, 1);
  assert.equal(duplicated.skipped.at(-1)?.reason, 'duplicate-in-batch');
});

test('dedupe key is case-insensitive on the address', () => {
  const result = selectTargets([table([row({ ...ELIGIBLE, メールアドレス: 'A@B.COM' })])], BASE);
  assert.equal(result.targets[0]?.dedupeKey, 'a@b.com|2026-09-08|d-1');
});

test('finds the header even when it is not the first row', () => {
  const padded: SheetTable = { sheetId: 2, title: 'KPI', rows: [[''], ['', ''], HEADER, row(ELIGIBLE)] };
  const result = selectTargets([padded], BASE);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0]?.rowNumber, 4);
});

test('reports sheets with no recognisable header instead of throwing', () => {
  const kpi: SheetTable = { sheetId: 3, title: '大津', rows: [['', '現状KPI', '初回設定'], ['', '目標数値', '80']] };
  const result = selectTargets([kpi], BASE);
  assert.equal(result.targets.length, 0);
  assert.equal(result.skipped[0]?.reason, 'no-header');
});

test('tolerates reordered and extra columns', () => {
  const reordered = ['メールアドレス', '初回面接予定日', 'メモ', '求職者名', '面接設定可否', 'リマインド可否'];
  const shuffled: SheetTable = {
    sheetId: 4,
    title: 'reordered',
    rows: [reordered, ['a@b.com', '2026/09/08', 'note', '山田 太郎', '設定済み', '']],
  };
  const result = selectTargets([shuffled], BASE);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0]?.candidateName, '山田 太郎');
  assert.equal(result.targets[0]?.remindFlagColumnIndex, 5);
});

test('short rows do not throw when trailing cells are absent', () => {
  const sparse: SheetTable = {
    sheetId: 5,
    title: 'sparse',
    rows: [HEADER, ['株式会社X', '9/1', '事務', '短 行', '24', '新田', 'a@b.com']],
  };
  const result = selectTargets([sparse], { ...BASE, interviewScheduledValues: [] });
  assert.equal(result.targets.length, 0);
  assert.equal(result.skipped[0]?.reason, 'unparsable-interview-date');
});
