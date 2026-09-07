import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderMail } from '../src/domain/template.ts';
import { buildRawMessage } from '../src/google/gmail-sender.ts';
import type { ReminderTarget } from '../src/domain/types.ts';
import type { JstDay } from '../src/domain/jst.ts';

const TARGET: ReminderTarget = {
  sheetId: 1,
  sheetTitle: '応募振り分け',
  rowNumber: 2,
  candidateName: '泉 琴音',
  email: 'izumi@example.com',
  company: '株式会社EatLABO',
  jobTitle: '《未経験》事務/仙台市',
  owner: '新田',
  interviewDay: '2026-09-08' as JstDay,
  interviewTime: '14:30',
  remindFlagColumnIndex: 12,
  dedupeKey: 'izumi@example.com|2026-09-08|d-1',
};

test('substitutes every known placeholder', () => {
  const rendered = renderMail(
    { subject: '【{{company}}】{{interviewDate}}', body: '{{candidateName}} 様\n{{interviewDateTime}}\n{{owner}}' },
    TARGET,
  );
  assert.equal(rendered.subject, '【株式会社EatLABO】2026年9月8日(火)');
  assert.equal(rendered.body, '泉 琴音 様\n2026年9月8日(火) 14:30\n新田');
});

test('omits the time when the cell had none', () => {
  const rendered = renderMail({ subject: 's', body: '{{interviewDateTime}}' }, { ...TARGET, interviewTime: null });
  assert.equal(rendered.body, '2026年9月8日(火)');
});

test('leaves unknown placeholders visible instead of blanking them', () => {
  const rendered = renderMail({ subject: 's', body: '{{typo}}' }, TARGET);
  assert.equal(rendered.body, '{{typo}}');
});

test('a newline in the subject template cannot split the header', () => {
  const rendered = renderMail({ subject: 'A\nBcc: attacker@example.com', body: 'b' }, TARGET);
  assert.equal(rendered.subject, 'A Bcc: attacker@example.com');
});

test('header injection via a sheet value cannot add headers to the raw message', () => {
  const raw = buildRawMessage(
    { from: 'nitta@quad-4.co.jp', fromDisplayName: '新田', to: 'victim@example.com', subject: 'X\r\nBcc: attacker@example.com', body: 'hello' },
    { bccAddresses: [], senderNameSuffix: '' },
  );
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const headerBlock = decoded.split('\r\n\r\n')[0] ?? '';
  assert.equal(headerBlock.split('\r\n').filter((line) => line.startsWith('Bcc:')).length, 0);
});

test('encodes a Japanese subject and display name as RFC 2047 words', () => {
  const raw = buildRawMessage(
    { from: 'nitta@quad-4.co.jp', fromDisplayName: '新田', to: 'a@b.com', subject: '【面接日程のご確認】', body: '本文' },
    { bccAddresses: ['ops@quad-4.co.jp'], senderNameSuffix: '株式会社Quad' },
  );
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);
  // From must be the 担当者's own address, displayed as 新田（株式会社Quad）.
  assert.match(decoded, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <nitta@quad-4\.co\.jp>$/m);
  const fromName = /^From: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/m.exec(decoded)?.[1] ?? '';
  assert.equal(Buffer.from(fromName, 'base64').toString('utf8'), '新田（株式会社Quad）');
  assert.match(decoded, /^Bcc: ops@quad-4\.co\.jp$/m);

  const body = decoded.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), '本文');
});

test('an ASCII-only subject is left unencoded', () => {
  const raw = buildRawMessage(
    { from: 'a@quad-4.co.jp', fromDisplayName: '', to: 'a@b.com', subject: 'Interview reminder', body: 'hi' },
    { bccAddresses: [], senderNameSuffix: '' },
  );
  assert.match(Buffer.from(raw, 'base64url').toString('utf8'), /^Subject: Interview reminder$/m);
});
