import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forwardMailToLine, TooManyPendingMailsError } from '../src/usecase/forward-mail-to-line.ts';
import { buildSearchQuery } from '../src/google/gmail-inbox.ts';
import { loadForwardConfig } from '../src/forward-config.ts';
import type { ReceivedMail } from '../src/domain/mail.ts';
import type { Logger, MailInbox, Notifier } from '../src/ports.ts';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const mail = (id: string, minute: number): ReceivedMail => ({
  id,
  threadId: `t-${id}`,
  from: `sender <y.shirai@linkup-c3.jp>`,
  fromAddress: 'y.shirai@linkup-c3.jp',
  subject: `件名 ${id}`,
  receivedAt: new Date(Date.UTC(2026, 8, 7, 1, minute)),
  bodyText: 'body',
  attachmentNames: [],
});

class FakeInbox implements MailInbox {
  readonly labelled: string[] = [];
  #pending: readonly ReceivedMail[];
  #labelError: Error | null;

  constructor(pending: readonly ReceivedMail[], labelError: Error | null = null) {
    this.#pending = pending;
    this.#labelError = labelError;
  }

  fetchPending(): Promise<readonly ReceivedMail[]> {
    return Promise.resolve(this.#pending);
  }

  markForwarded(mailId: string): Promise<void> {
    if (this.#labelError !== null) return Promise.reject(this.#labelError);
    this.labelled.push(mailId);
    return Promise.resolve();
  }
}

class FakeNotifier implements Notifier {
  readonly pushes: { text: string; key: string }[] = [];
  #failFrom: number;

  constructor(failFrom = Number.POSITIVE_INFINITY) {
    this.#failFrom = failFrom;
  }

  push(text: string, key: string): Promise<void> {
    if (this.pushes.length >= this.#failFrom) return Promise.reject(new Error('LINE push failed: 401'));
    this.pushes.push({ text, key });
    return Promise.resolve();
  }
}

const options = {
  bodyMaxChars: 700,
  maxPushesPerRun: 20,
  includeGmailLink: true,
  gmailUserIndex: 0,
  dryRun: false,
} as const;

describe('forwardMailToLine', () => {
  it('pushes every pending mail and labels it', async () => {
    const inbox = new FakeInbox([mail('a', 1), mail('b', 2)]);
    const notifier = new FakeNotifier();

    const report = await forwardMailToLine({ inbox, notifier, logger: silentLogger }, options);

    assert.deepEqual(report, { pending: 2, pushed: 2, failed: 0, dryRun: false });
    assert.deepEqual(inbox.labelled, ['a', 'b']);
    assert.equal(notifier.pushes.length, 2);
  });

  it('does not label anything in a dry run', async () => {
    const inbox = new FakeInbox([mail('a', 1)]);
    const notifier = new FakeNotifier();

    const report = await forwardMailToLine(
      { inbox, notifier, logger: silentLogger },
      { ...options, dryRun: true },
    );

    assert.equal(report.pushed, 1);
    assert.deepEqual(inbox.labelled, []);
  });

  it('pushes nothing at all when the batch exceeds the cap', async () => {
    const inbox = new FakeInbox([mail('a', 1), mail('b', 2), mail('c', 3)]);
    const notifier = new FakeNotifier();

    await assert.rejects(
      forwardMailToLine({ inbox, notifier, logger: silentLogger }, { ...options, maxPushesPerRun: 2 }),
      TooManyPendingMailsError,
    );
    assert.equal(notifier.pushes.length, 0);
  });

  it('stops at the first push failure and leaves the rest unlabelled for the next run', async () => {
    const inbox = new FakeInbox([mail('a', 1), mail('b', 2), mail('c', 3)]);
    const notifier = new FakeNotifier(1);

    const report = await forwardMailToLine({ inbox, notifier, logger: silentLogger }, options);

    assert.deepEqual(report, { pending: 3, pushed: 1, failed: 1, dryRun: false });
    assert.deepEqual(inbox.labelled, ['a']);
  });

  it('fails loudly when the dedupe label cannot be written', async () => {
    const inbox = new FakeInbox([mail('a', 1)], new Error('insufficient permission'));
    const notifier = new FakeNotifier();

    await assert.rejects(forwardMailToLine({ inbox, notifier, logger: silentLogger }, options), /insufficient permission/);
  });
});

describe('buildSearchQuery', () => {
  it('scopes by sender, label and time window', () => {
    const query = buildSearchQuery(
      {
        watchSenders: ['y.shirai@linkup-c3.jp', 'other@example.com'],
        forwardedLabel: 'LINE転送済み',
        lookbackMinutes: 60,
        maxResults: 21,
      },
      new Date('2026-09-07T00:00:00Z'),
    );
    assert.equal(
      query,
      '(from:y.shirai@linkup-c3.jp OR from:other@example.com) -label:"LINE転送済み" after:1788735600 -in:chats -in:drafts',
    );
  });
});

describe('loadForwardConfig', () => {
  const base = {
    WATCH_SENDERS: 'Y.Shirai@linkup-c3.jp',
    LINE_CHANNEL_ACCESS_TOKEN: 'token',
    LINE_TO: `U${'a'.repeat(32)}`,
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'refresh',
  } as const;

  it('lower-cases watched senders and defaults to a dry run', () => {
    const config = loadForwardConfig(base);
    assert.deepEqual(config.watchSenders, ['y.shirai@linkup-c3.jp']);
    assert.equal(config.dryRun, true);
    assert.equal(config.forwardedLabel, 'LINE転送済み');
  });

  it('rejects a malformed LINE target id', () => {
    assert.throws(() => loadForwardConfig({ ...base, LINE_TO: 'hiroto-inagaki' }), /Invalid LINE_TO/);
  });

  it('rejects a malformed watched address', () => {
    assert.throws(() => loadForwardConfig({ ...base, WATCH_SENDERS: 'not-an-address' }), /WATCH_SENDERS/);
  });

  it('rejects an out-of-range lookback window', () => {
    assert.throws(
      () => loadForwardConfig({ ...base, FORWARD_LOOKBACK_MINUTES: '0' }),
      /FORWARD_LOOKBACK_MINUTES/,
    );
  });
});
