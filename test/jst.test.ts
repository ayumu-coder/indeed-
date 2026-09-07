import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addDays, daysBetween, formatJapanese, makeJstDay, toJstDay } from '../src/domain/jst.ts';

test('toJstDay rolls over at 15:00 UTC, not at UTC midnight', () => {
  assert.equal(toJstDay(new Date('2026-09-07T14:59:59Z')), '2026-09-07');
  assert.equal(toJstDay(new Date('2026-09-07T15:00:00Z')), '2026-09-08');
});

test('toJstDay on a UTC-evening run still reports the next JST day', () => {
  // A 21:00 UTC cron fires at 06:00 JST the following morning.
  assert.equal(toJstDay(new Date('2026-12-31T21:00:00Z')), '2027-01-01');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays(makeJstDay(2026, 1, 31), 1), '2026-02-01');
  assert.equal(addDays(makeJstDay(2026, 12, 31), 1), '2027-01-01');
  assert.equal(addDays(makeJstDay(2028, 2, 28), 1), '2028-02-29');
  assert.equal(addDays(makeJstDay(2026, 3, 1), -1), '2026-02-28');
});

test('formatJapanese renders the weekday', () => {
  assert.equal(formatJapanese(makeJstDay(2026, 9, 8)), '2026年9月8日(火)');
});

test('daysBetween is signed and symmetric', () => {
  assert.equal(daysBetween(makeJstDay(2026, 9, 7), makeJstDay(2026, 9, 9)), 2);
  assert.equal(daysBetween(makeJstDay(2026, 9, 9), makeJstDay(2026, 9, 7)), -2);
});
