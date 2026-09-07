import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectAttachmentNames,
  decodeEncodedWords,
  extractPlainText,
  getHeader,
  normaliseText,
  parseAddress,
  stripHtml,
  type MimePart,
} from '../src/domain/mime.ts';

const b64url = (text: string, encoding: BufferEncoding = 'utf8'): string =>
  Buffer.from(text, encoding).toString('base64url');

describe('decodeEncodedWords', () => {
  it('decodes a base64 UTF-8 subject', () => {
    const encoded = `=?UTF-8?B?${Buffer.from('面接日程のご連絡', 'utf8').toString('base64')}?=`;
    assert.equal(decodeEncodedWords(encoded), '面接日程のご連絡');
  });

  it('joins adjacent encoded words without inserting the separating space', () => {
    const part = (text: string): string => `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
    assert.equal(decodeEncodedWords(`${part('求人')} ${part('のご相談')}`), '求人のご相談');
  });

  it('decodes Q-encoding including underscore-as-space', () => {
    assert.equal(decodeEncodedWords('=?UTF-8?Q?Hello_W=C3=B6rld?=' ), 'Hello Wörld');
  });

  it('decodes ISO-2022-JP', () => {
    // ESC $ B あ い う ESC ( B
    const jis = Buffer.from('1b24422422242424261b2842', 'hex').toString('base64');
    assert.equal(decodeEncodedWords(`=?ISO-2022-JP?B?${jis}?=`), 'あいう');
  });

  it('leaves text without encoded words untouched', () => {
    assert.equal(decodeEncodedWords('Re: meeting'), 'Re: meeting');
  });

  it('falls back to UTF-8 on an unknown charset label rather than throwing', () => {
    const encoded = `=?X-UNKNOWN?B?${Buffer.from('テスト', 'utf8').toString('base64')}?=`;
    assert.equal(decodeEncodedWords(encoded), 'テスト');
  });

  it('leaves a malformed encoded word verbatim', () => {
    assert.equal(decodeEncodedWords('=?UTF-8?Q?=ZZ?='), '=?UTF-8?Q?=ZZ?=');
  });
});

describe('parseAddress', () => {
  it('extracts the address from a display-name form', () => {
    assert.equal(parseAddress('"白井" <Y.Shirai@Linkup-C3.jp>'), 'y.shirai@linkup-c3.jp');
  });

  it('accepts a bare address', () => {
    assert.equal(parseAddress('y.shirai@linkup-c3.jp'), 'y.shirai@linkup-c3.jp');
  });

  it('returns empty for a header with no address', () => {
    assert.equal(parseAddress('undisclosed recipients'), '');
  });
});

describe('extractPlainText', () => {
  it('prefers text/plain inside multipart/alternative', () => {
    const payload: MimePart = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('本文です') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html</p>') } },
      ],
    };
    assert.equal(extractPlainText(payload), '本文です');
  });

  it('falls back to stripped HTML', () => {
    const payload: MimePart = {
      mimeType: 'text/html',
      body: { data: b64url('<div>一行目</div><div>二行目</div>') },
    };
    assert.equal(extractPlainText(payload), '一行目\n二行目');
  });

  it('honours a non-UTF-8 charset declared on the part', () => {
    const payload: MimePart = {
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset="Shift_JIS"' }],
      body: { data: Buffer.from('82a082a2', 'hex').toString('base64url') },
    };
    assert.equal(extractPlainText(payload), 'あい');
  });

  it('ignores attachment parts when looking for the body', () => {
    const payload: MimePart = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', filename: 'note.txt', body: { data: b64url('attachment') } },
        { mimeType: 'text/plain', body: { data: b64url('real body') } },
      ],
    };
    assert.equal(extractPlainText(payload), 'real body');
  });

  it('returns empty string when there is no textual part', () => {
    assert.equal(extractPlainText({ mimeType: 'application/pdf' }), '');
    assert.equal(extractPlainText(null), '');
  });
});

describe('stripHtml / normaliseText', () => {
  it('drops script and style content', () => {
    assert.equal(normaliseText(stripHtml('<style>p{}</style><script>x()</script><p>text</p>')), 'text');
  });

  it('decodes entities', () => {
    assert.equal(stripHtml('a &amp; b &#65; &#x42; &nbsp;c'), 'a & b A B  c');
  });

  it('collapses runs of blank lines and trailing spaces', () => {
    assert.equal(normaliseText('a  \r\n\n\n\nb\n\n'), 'a\n\nb');
  });
});

describe('getHeader / collectAttachmentNames', () => {
  it('matches header names case-insensitively', () => {
    const part: MimePart = { headers: [{ name: 'SuBjEcT', value: 'hi' }] };
    assert.equal(getHeader(part, 'subject'), 'hi');
    assert.equal(getHeader(part, 'from'), '');
  });

  it('collects decoded attachment filenames from every depth', () => {
    const encoded = `=?UTF-8?B?${Buffer.from('請求書.pdf', 'utf8').toString('base64')}?=`;
    const payload: MimePart = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('body') } },
        { mimeType: 'multipart/mixed', parts: [{ filename: encoded, body: { attachmentId: 'a1' } }] },
      ],
    };
    assert.deepEqual(collectAttachmentNames(payload), ['請求書.pdf']);
  });
});
