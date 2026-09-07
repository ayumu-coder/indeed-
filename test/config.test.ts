import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';

const SERVICE_ACCOUNT_KEY = JSON.stringify({
  client_email: 'reminder@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n',
});

const MINIMAL = {
  SPREADSHEET_ID: 'sheet-id',
  GOOGLE_SERVICE_ACCOUNT_KEY: SERVICE_ACCOUNT_KEY,
  OWNER_EMAIL_MAP: '新田:nitta@quad-4.co.jp,針山:hariyama@quad-4.co.jp',
} as const;

test('defaults to a dry run so an unset flag cannot mail candidates', () => {
  assert.equal(loadConfig(MINIMAL).dryRun, true);
  assert.equal(loadConfig({ ...MINIMAL, DRY_RUN: 'false' }).dryRun, false);
});

test('リマインド可否 defaults to an approval flag, and is never overwritten', () => {
  const config = loadConfig(MINIMAL);
  assert.equal(config.remindFlagMode, 'requireMarked');
  assert.equal(config.writeBackRemindFlag, false);
});

test('applies the documented defaults', () => {
  const config = loadConfig(MINIMAL);
  assert.equal(config.offsetDays, 1);
  assert.deepEqual(config.interviewScheduledValues, ['設定済み']);
  assert.equal(config.logSheetTitle, '_reminder_log');
  assert.equal(config.maxSendsPerRun, 50);
  assert.equal(config.fallbackToDefaultSender, false);
  assert.equal(config.defaultSenderAddress, null);
});

test('parses the 担当者 map and normalises the service account key newlines', () => {
  const config = loadConfig(MINIMAL);
  assert.equal(config.ownerEmails.get('新田'), 'nitta@quad-4.co.jp');
  assert.equal(config.ownerEmails.get('針山'), 'hariyama@quad-4.co.jp');
  assert.equal(config.auth.mode, 'serviceAccount');
  if (config.auth.mode !== 'serviceAccount') throw new Error('unreachable');
  assert.ok(config.auth.key.private_key.includes('\n'));
  assert.ok(!config.auth.key.private_key.includes('\\n'));
});

test('requires at least one way to determine a sender', () => {
  assert.throws(
    () => loadConfig({ SPREADSHEET_ID: 'x', GOOGLE_SERVICE_ACCOUNT_KEY: SERVICE_ACCOUNT_KEY }),
    /OWNER_EMAIL_MAP/,
  );
});

test('OAuth mode is rejected when it would send as the wrong 担当者', () => {
  const oauth = {
    SPREADSHEET_ID: 'x',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'token',
  } as const;
  assert.throws(
    () => loadConfig({ ...oauth, OWNER_EMAIL_MAP: '新田:nitta@quad-4.co.jp,針山:hariyama@quad-4.co.jp' }),
    /domain-wide delegation/,
  );
  // A single 担当者 mapping to the authorised address is fine.
  assert.doesNotThrow(() =>
    loadConfig({ ...oauth, OWNER_EMAIL_MAP: '新田:nitta@quad-4.co.jp', DEFAULT_SENDER_ADDRESS: 'nitta@quad-4.co.jp' }),
  );
});

test('rejects a malformed service account key', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, GOOGLE_SERVICE_ACCOUNT_KEY: 'not json' }), /not valid JSON/);
  assert.throws(() => loadConfig({ ...MINIMAL, GOOGLE_SERVICE_ACCOUNT_KEY: '{"private_key":"k"}' }), /client_email/);
  assert.throws(() => loadConfig({ ...MINIMAL, GOOGLE_SERVICE_ACCOUNT_KEY: '{"client_email":"a@b"}' }), /private_key/);
});

test('rejects a malformed 担当者 map', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, OWNER_EMAIL_MAP: '新田' }), /Invalid OWNER_EMAIL_MAP/);
});

test('parses sheet gids and rejects non-numeric ones', () => {
  assert.deepEqual(loadConfig({ ...MINIMAL, TARGET_SHEET_IDS: '1972955214, 0' }).targetSheetIds, [1972955214, 0]);
  assert.throws(() => loadConfig({ ...MINIMAL, TARGET_SHEET_IDS: 'abc' }), /Invalid sheet gid/);
});

test('rejects out-of-range and malformed values', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, SPREADSHEET_ID: '' }), /SPREADSHEET_ID/);
  assert.throws(() => loadConfig({ ...MINIMAL, REMIND_OFFSET_DAYS: '-1' }), /out of range/);
  assert.throws(() => loadConfig({ ...MINIMAL, REMIND_OFFSET_DAYS: '1.5' }), /Invalid integer/);
  assert.throws(() => loadConfig({ ...MINIMAL, DRY_RUN: 'maybe' }), /Invalid boolean/);
  assert.throws(() => loadConfig({ ...MINIMAL, REMIND_FLAG_MODE: 'always' }), /Invalid REMIND_FLAG_MODE/);
});
