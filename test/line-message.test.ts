import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLineText,
  gmailThreadUrl,
  LINE_TEXT_MAX_CHARS,
  truncateByCodePoints,
} from '../src/domain/line-message.ts';
import { deterministicRetryKey } from '../src/line/retry-key.ts';
import type { ReceivedMail } from '../src/domain/mail.ts';

const mail = (overrides: Partial<ReceivedMail> = {}): ReceivedMail => ({
  id: 'm1',
  threadId: 't1',
  from: '白井 <y.shirai@linkup-c3.jp>',
  fromAddress: 'y.shirai@linkup-c3.jp',
  subject: '面接候補日のご連絡',
  // 2026-09-07T05:32:00Z = 14:32 JST
  receivedAt: new Date('2026-09-07T05:32:00Z'),
  bodyText: 'お世話になっております。\n候補日は明日です。',
  attachmentNames: [],
  ...overrides,
});

describe('buildLineText', () => {
  it('renders sender, subject, JST timestamp and body', () => {
    const text = buildLineText(mail(), { bodyMaxChars: 700, gmailLink: null });
    assert.equal(
      text,
      [
        '📩 新着メール',
        '差出人: 白井 <y.shirai@linkup-c3.jp>',
        '件名: 面接候補日のご連絡',
        '受信: 2026年9月7日(月) 14:32',
        '──────────',
        'お世話になっております。\n候補日は明日です。',
      ].join('\n'),
    );
  });

  it('adds attachment names and the Gmail link when present', () => {
    const text = buildLineText(mail({ attachmentNames: ['a.pdf', 'b.xlsx'] }), {
      bodyMaxChars: 700,
      gmailLink: gmailThreadUrl('t1', 0),
    });
    assert.match(text, /添付: a\.pdf, b\.xlsx/);
    assert.match(text, /https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/t1$/);
  });

  it('substitutes placeholders for an empty subject and body', () => {
    const text = buildLineText(mail({ subject: '', bodyText: '' }), { bodyMaxChars: 700, gmailLink: null });
    assert.match(text, /件名: \(件名なし\)/);
    assert.match(text, /\(本文なし\)/);
  });

  it('never exceeds the LINE hard limit even with an enormous body', () => {
    const text = buildLineText(mail({ bodyText: 'あ'.repeat(20_000) }), {
      bodyMaxChars: 10_000,
      gmailLink: null,
    });
    assert.ok(Array.from(text).length <= LINE_TEXT_MAX_CHARS);
  });
});

describe('truncateByCodePoints', () => {
  it('leaves short text alone', () => {
    assert.equal(truncateByCodePoints('abc', 5), 'abc');
  });

  it('appends an ellipsis when cutting', () => {
    assert.equal(truncateByCodePoints('abcdef', 4), 'abc…');
  });

  it('does not split a surrogate pair', () => {
    const truncated = truncateByCodePoints('👨‍👩‍👧🍣🍣🍣', 3);
    assert.ok(!/[\uD800-\uDFFF]/.test(truncated.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')));
  });

  it('returns empty for a non-positive limit', () => {
    assert.equal(truncateByCodePoints('abc', 0), '');
  });
});

describe('deterministicRetryKey', () => {
  it('is a well-formed v4-shaped UUID', () => {
    assert.match(
      deterministicRetryKey('gmail-message-id'),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is stable per message and distinct across messages', () => {
    assert.equal(deterministicRetryKey('a'), deterministicRetryKey('a'));
    assert.notEqual(deterministicRetryKey('a'), deterministicRetryKey('b'));
  });
});
