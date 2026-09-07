import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';

const MINIMAL = {
  SPREADSHEET_ID: 'sheet-id',
  SENDER_ADDRESS: 'noreply@quad-4.co.jp',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: 'token',
} as const;

test('defaults to a dry run so an unset flag cannot mail candidates', () => {
  assert.equal(loadConfig(MINIMAL).dryRun, true);
  assert.equal(loadConfig({ ...MINIMAL, DRY_RUN: 'false' }).dryRun, false);
});

test('applies the documented defaults', () => {
  const config = loadConfig(MINIMAL);
  assert.equal(config.offsetDays, 1);
  assert.equal(config.remindFlagMode, 'skipIfMarked');
  assert.deepEqual(config.interviewScheduledValues, ['設定済み']);
  assert.equal(config.logSheetTitle, '_reminder_log');
  assert.equal(config.maxSendsPerRun, 50);
  assert.deepEqual(config.targetSheetIds, []);
});

test('an empty list env disables that gate', () => {
  assert.deepEqual(loadConfig({ ...MINIMAL, INTERVIEW_SCHEDULED_VALUES: '' }).interviewScheduledValues, []);
});

test('parses sheet gids and rejects non-numeric ones', () => {
  assert.deepEqual(loadConfig({ ...MINIMAL, TARGET_SHEET_IDS: '1972955214, 0' }).targetSheetIds, [1972955214, 0]);
  assert.throws(() => loadConfig({ ...MINIMAL, TARGET_SHEET_IDS: 'abc' }), /Invalid sheet gid/);
});

test('rejects missing credentials and out-of-range values', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, SPREADSHEET_ID: '' }), /SPREADSHEET_ID/);
  assert.throws(() => loadConfig({ ...MINIMAL, GOOGLE_REFRESH_TOKEN: undefined }), /GOOGLE_REFRESH_TOKEN/);
  assert.throws(() => loadConfig({ ...MINIMAL, REMIND_OFFSET_DAYS: '-1' }), /out of range/);
  assert.throws(() => loadConfig({ ...MINIMAL, REMIND_OFFSET_DAYS: '1.5' }), /Invalid integer/);
  assert.throws(() => loadConfig({ ...MINIMAL, DRY_RUN: 'maybe' }), /Invalid boolean/);
  assert.throws(() => loadConfig({ ...MINIMAL, REMIND_FLAG_MODE: 'always' }), /Invalid REMIND_FLAG_MODE/);
});
