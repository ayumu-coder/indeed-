import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sendReminders, type SendRemindersOptions } from '../src/usecase/send-reminders.ts';
import type { CandidateSource, MailSender, OutgoingMail, RemindFlagWriter, SendLog, SentRecord } from '../src/ports.ts';
import { buildOwnerEmailMap } from '../src/domain/sender.ts';
import type { ReminderTarget, SheetTable } from '../src/domain/types.ts';

const NOW = new Date('2026-09-07T02:00:00Z');

const HEADER = ['求職者名', 'メールアドレス', '担当者', '面接設定可否', '初回面接予定日', 'リマインド可否'];
const TABLE: SheetTable = {
  sheetId: 1,
  title: '応募振り分け',
  rows: [
    HEADER,
    ['山田 太郎', 'taro@example.com', '新田', '設定済み', '2026/09/08', '実施'],
    ['佐藤 花子', 'hanako@example.com', '針山', '設定済み', '2026/09/08', '実施'],
    ['来月 次郎', 'jiro@example.com', '新田', '設定済み', '2026/10/08', '実施'],
  ],
};

const SENDER_POLICY = {
  ownerEmails: buildOwnerEmailMap(['新田:nitta@quad-4.co.jp', '針山:hariyama@quad-4.co.jp']),
  defaultAddress: null,
  fallbackToDefault: false,
};

const SILENT = { info: () => {}, warn: () => {}, error: () => {} };

const OPTIONS: SendRemindersOptions = {
  offsetDays: 1,
  remindFlagMode: 'requireMarked',
  remindFlagAllowValues: ['実施'],
  interviewScheduledValues: ['設定済み'],
  remindFlagWriteValue: '実施',
  senderPolicy: SENDER_POLICY,
  templates: { subject: '{{interviewDate}}', body: '{{candidateName}} 様' },
  dryRun: false,
  maxSendsPerRun: 50,
};

class RecordingSender implements MailSender {
  readonly sent: OutgoingMail[] = [];
  readonly #failFor: ReadonlySet<string>;
  constructor(failFor: ReadonlySet<string> = new Set()) {
    this.#failFor = failFor;
  }
  send(mail: OutgoingMail): Promise<void> {
    if (this.#failFor.has(mail.to)) return Promise.reject(new Error('550 mailbox unavailable'));
    this.sent.push(mail);
    return Promise.resolve();
  }
}

class MemoryLog implements SendLog {
  readonly appended: SentRecord[] = [];
  readonly #keys: ReadonlySet<string>;
  constructor(keys: ReadonlySet<string> = new Set()) {
    this.#keys = keys;
  }
  loadSentKeys(): Promise<ReadonlySet<string>> { return Promise.resolve(this.#keys); }
  append(records: readonly SentRecord[]): Promise<void> { this.appended.push(...records); return Promise.resolve(); }
}

class MemoryFlagWriter implements RemindFlagWriter {
  marked: ReminderTarget[] = [];
  readonly #shouldThrow: boolean;
  constructor(shouldThrow = false) {
    this.#shouldThrow = shouldThrow;
  }
  markReminded(targets: readonly ReminderTarget[]): Promise<void> {
    if (this.#shouldThrow) return Promise.reject(new Error('permission denied'));
    this.marked = [...targets];
    return Promise.resolve();
  }
}

const source: CandidateSource = { loadTables: () => Promise.resolve([TABLE]) };
const clock = { now: () => NOW };

test('sends to every eligible row and marks the flag', async () => {
  const sender = new RecordingSender();
  const log = new MemoryLog();
  const flags = new MemoryFlagWriter();

  const report = await sendReminders(
    { source, sender, sendLog: log, flagWriter: flags, clock, logger: SILENT },
    OPTIONS,
  );

  assert.equal(report.sent, 2);
  assert.equal(report.failed, 0);
  assert.equal(report.targetDay, '2026-09-08');
  assert.deepEqual(sender.sent.map((mail) => mail.to), ['taro@example.com', 'hanako@example.com']);
  // Each reminder goes out as its own 担当者.
  assert.deepEqual(sender.sent.map((mail) => mail.from), ['nitta@quad-4.co.jp', 'hariyama@quad-4.co.jp']);
  assert.deepEqual(sender.sent.map((mail) => mail.fromDisplayName), ['新田', '針山']);
  assert.equal(sender.sent[0]?.body, '山田 太郎 様');
  assert.equal(flags.marked.length, 2);
  assert.deepEqual(log.appended.map((record) => record.status), ['sent', 'sent']);
});

test('dry run sends nothing, writes no flags, but still logs', async () => {
  const sender = new RecordingSender();
  const log = new MemoryLog();

  const report = await sendReminders(
    { source, sender, sendLog: log, flagWriter: null, clock, logger: SILENT },
    { ...OPTIONS, dryRun: true },
  );

  assert.equal(report.sent, 0);
  assert.equal(report.considered, 2);
  assert.equal(sender.sent.length, 0);
  assert.deepEqual(log.appended.map((record) => record.status), ['dry-run', 'dry-run']);
});

test('a failed send is reported, logged as failed, and not marked as reminded', async () => {
  const sender = new RecordingSender(new Set(['taro@example.com']));
  const log = new MemoryLog();
  const flags = new MemoryFlagWriter();

  const report = await sendReminders(
    { source, sender, sendLog: log, flagWriter: flags, clock, logger: SILENT },
    OPTIONS,
  );

  assert.equal(report.sent, 1);
  assert.equal(report.failed, 1);
  assert.deepEqual(log.appended.map((record) => record.status), ['failed', 'sent']);
  assert.deepEqual(flags.marked.map((target) => target.email), ['hanako@example.com']);
});

test('a failed send is retried on the next run because only sent keys dedupe', async () => {
  const log = new MemoryLog(new Set(['hanako@example.com|2026-09-08|d-1']));
  const sender = new RecordingSender();

  const report = await sendReminders(
    { source, sender, sendLog: log, flagWriter: null, clock, logger: SILENT },
    OPTIONS,
  );

  assert.deepEqual(sender.sent.map((mail) => mail.to), ['taro@example.com']);
  assert.equal(report.sent, 1);
});

test('write-back failure does not fail the run', async () => {
  const report = await sendReminders(
    { source, sender: new RecordingSender(), sendLog: new MemoryLog(), flagWriter: new MemoryFlagWriter(true), clock, logger: SILENT },
    OPTIONS,
  );
  assert.equal(report.sent, 2);
  assert.equal(report.failed, 0);
});

test('the per-run ceiling aborts before a single message goes out', async () => {
  const sender = new RecordingSender();
  await assert.rejects(
    sendReminders(
      { source, sender, sendLog: new MemoryLog(), flagWriter: null, clock, logger: SILENT },
      { ...OPTIONS, maxSendsPerRun: 1 },
    ),
    /exceeds MAX_SENDS_PER_RUN=1/,
  );
  assert.equal(sender.sent.length, 0);
});

test('an unmapped 担当者 blocks that row, sends the rest, and fails the run', async () => {
  const table: SheetTable = {
    sheetId: 1,
    title: '応募振り分け',
    rows: [
      HEADER,
      ['山田 太郎', 'taro@example.com', '新田', '設定済み', '2026/09/08', '実施'],
      ['未登録 担当', 'unknown@example.com', '大津', '設定済み', '2026/09/08', '実施'],
    ],
  };
  const sender = new RecordingSender();
  const log = new MemoryLog();

  const report = await sendReminders(
    { source: { loadTables: () => Promise.resolve([table]) }, sender, sendLog: log, flagWriter: null, clock, logger: SILENT },
    OPTIONS,
  );

  assert.deepEqual(sender.sent.map((mail) => mail.to), ['taro@example.com']);
  assert.deepEqual(report.unmappedOwners, ['大津']);
  assert.equal(report.skipped.at(-1)?.reason, 'owner-not-mapped');
  // The blocked row must not be recorded as sent, so it goes out once 大津 is mapped.
  assert.deepEqual(log.appended.map((record) => record.email), ['taro@example.com']);
});

test('the fallback address is used only when explicitly enabled', async () => {
  const table: SheetTable = {
    sheetId: 1,
    title: '応募振り分け',
    rows: [HEADER, ['未登録 担当', 'x@example.com', '大津', '設定済み', '2026/09/08', '実施']],
  };
  const source = { loadTables: () => Promise.resolve([table]) };
  const sender = new RecordingSender();

  await sendReminders(
    { source, sender, sendLog: new MemoryLog(), flagWriter: null, clock, logger: SILENT },
    { ...OPTIONS, senderPolicy: { ...SENDER_POLICY, defaultAddress: 'info@quad-4.co.jp', fallbackToDefault: true } },
  );

  assert.deepEqual(sender.sent.map((mail) => mail.from), ['info@quad-4.co.jp']);
});

test('requireMarked skips rows whose リマインド可否 is blank', async () => {
  const table: SheetTable = {
    sheetId: 1,
    title: '応募振り分け',
    rows: [
      HEADER,
      ['未承認 太郎', 'pending@example.com', '新田', '設定済み', '2026/09/08', ''],
      ['承認済 花子', 'ok@example.com', '新田', '設定済み', '2026/09/08', '実施'],
    ],
  };
  const sender = new RecordingSender();

  await sendReminders(
    { source: { loadTables: () => Promise.resolve([table]) }, sender, sendLog: new MemoryLog(), flagWriter: null, clock, logger: SILENT },
    OPTIONS,
  );

  assert.deepEqual(sender.sent.map((mail) => mail.to), ['ok@example.com']);
});
