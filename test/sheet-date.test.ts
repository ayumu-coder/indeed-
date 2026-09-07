import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseSheetDate } from '../src/domain/sheet-date.ts';

const NOW = new Date('2026-09-07T00:00:00Z');

test('parses the spreadsheet display format', () => {
  assert.deepEqual(parseSheetDate('2026/07/28 0:00:00', NOW), { day: '2026-07-28', timeOfDay: null });
  assert.deepEqual(parseSheetDate('2026/07/28 14:30:00', NOW), { day: '2026-07-28', timeOfDay: '14:30' });
  assert.deepEqual(parseSheetDate('2026-07-28', NOW), { day: '2026-07-28', timeOfDay: null });
  assert.deepEqual(parseSheetDate('2026年7月28日', NOW), { day: '2026-07-28', timeOfDay: null });
});

test('resolves year-less cells to the nearest year', () => {
  assert.deepEqual(parseSheetDate('5/13', NOW), { day: '2026-05-13', timeOfDay: null });
  // Late December: "1/5" is next year, not ten months ago.
  assert.deepEqual(parseSheetDate('1/5', new Date('2026-12-28T00:00:00Z')), { day: '2027-01-05', timeOfDay: null });
});

test('parses Sheets serial numbers without timezone drift', () => {
  // 46231 is 2026-07-28 in the 1899-12-30 epoch used by Google Sheets.
  assert.deepEqual(parseSheetDate(46231, NOW), { day: '2026-07-28', timeOfDay: null });
  assert.deepEqual(parseSheetDate(46231.5, NOW), { day: '2026-07-28', timeOfDay: '12:00' });
  assert.deepEqual(parseSheetDate('46231', NOW), { day: '2026-07-28', timeOfDay: null });
});

test('rejects everything it cannot understand rather than guessing', () => {
  for (const value of ['', '   ', '未定', 'TBD', '調整中', null, undefined, {}, '2026/13/45', '99/99']) {
    assert.equal(parseSheetDate(value, NOW), null, `expected null for ${JSON.stringify(value)}`);
  }
});

test('rejects impossible calendar dates', () => {
  assert.equal(parseSheetDate('2026/02/30', NOW), null);
  assert.deepEqual(parseSheetDate('2028/02/29', NOW), { day: '2028-02-29', timeOfDay: null });
});
