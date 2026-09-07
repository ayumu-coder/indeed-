/**
 * Decoding of the Gmail API message payload. Pure: it knows the shape of the
 * payload but imports nothing from `googleapis`, so every branch is unit-testable.
 */

export interface MimeHeader {
  readonly name?: string | null;
  readonly value?: string | null;
}

export interface MimeBody {
  readonly data?: string | null;
  readonly attachmentId?: string | null;
}

export interface MimePart {
  readonly mimeType?: string | null;
  readonly filename?: string | null;
  readonly headers?: readonly MimeHeader[] | null;
  readonly body?: MimeBody | null;
  readonly parts?: readonly MimePart[] | null;
}

/** Gmail hands headers back in whatever case the sender used. */
export function getHeader(part: MimePart | null | undefined, name: string): string {
  const wanted = name.toLowerCase();
  for (const header of part?.headers ?? []) {
    if ((header.name ?? '').toLowerCase() === wanted) return header.value ?? '';
  }
  return '';
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const label = charset.trim().toLowerCase().replace(/^["']|["']$/g, '');
  try {
    return new TextDecoder(label === '' ? 'utf-8' : label).decode(bytes);
  } catch {
    // Unknown or ICU-less label (e.g. a rare Japanese alias): UTF-8 is the least
    // surprising fallback and mojibake is preferable to dropping the mail.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeQEncoded(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (char === '_') {
      bytes.push(0x20);
    } else if (char === '=' && i + 2 < text.length) {
      const hex = text.slice(i + 1, i + 3);
      const value = Number.parseInt(hex, 16);
      if (Number.isNaN(value)) throw new Error(`Invalid Q-encoding: =${hex}`);
      bytes.push(value);
      i += 2;
    } else {
      bytes.push(char.charCodeAt(0));
    }
  }
  return Uint8Array.from(bytes);
}

const ENCODED_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

/**
 * RFC 2047 encoded-words, as used by every Japanese subject line
 * (`=?UTF-8?B?...?=`, `=?ISO-2022-JP?B?...?=`). Undecodable words are left
 * verbatim rather than dropped.
 */
export function decodeEncodedWords(input: string): string {
  if (!input.includes('=?')) return input;
  // RFC 2047 §6.2: whitespace between two adjacent encoded words is not data.
  const joined = input.replace(/\?=\s+=\?/g, '?==?');
  return joined.replace(ENCODED_WORD, (whole, charset: string, encoding: string, text: string) => {
    try {
      const bytes = encoding.toUpperCase() === 'B'
        ? new Uint8Array(Buffer.from(text, 'base64'))
        : decodeQEncoded(text);
      return decodeBytes(bytes, charset);
    } catch {
      return whole;
    }
  });
}

/** `"名前" <a@b.jp>` → `a@b.jp`. Returns '' when no address is present. */
export function parseAddress(fromHeader: string): string {
  const decoded = decodeEncodedWords(fromHeader);
  const angled = /<([^<>]+)>/.exec(decoded);
  const candidate = (angled?.[1] ?? decoded).trim().replace(/^["']|["']$/g, '');
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : '';
}

function charsetOf(part: MimePart): string {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(getHeader(part, 'content-type'));
  return match?.[1] ?? 'utf-8';
}

function decodePartBody(part: MimePart): string {
  const data = part.body?.data;
  if (typeof data !== 'string' || data === '') return '';
  return decodeBytes(new Uint8Array(Buffer.from(data, 'base64url')), charsetOf(part));
}

function isAttachment(part: MimePart): boolean {
  return (part.filename ?? '') !== '' || (part.body?.attachmentId ?? '') !== '';
}

function findPart(part: MimePart | null | undefined, mimeType: string): MimePart | null {
  if (part === null || part === undefined) return null;
  if ((part.mimeType ?? '') === mimeType && !isAttachment(part)) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found !== null) return found;
  }
  return null;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x')
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      // Out-of-range references throw in fromCodePoint; keep the raw entity instead.
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[lower] ?? whole;
  });
}

/** Good enough for a notification preview — not a general-purpose HTML renderer. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

/** Collapses the whitespace noise that survives quoted-printable and HTML. */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t　]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** text/plain if the message has one, otherwise text/html stripped down to text. */
export function extractPlainText(payload: MimePart | null | undefined): string {
  const plain = findPart(payload, 'text/plain');
  if (plain !== null) return normaliseText(decodePartBody(plain));
  const html = findPart(payload, 'text/html');
  if (html !== null) return normaliseText(stripHtml(decodePartBody(html)));
  return '';
}

export function collectAttachmentNames(payload: MimePart | null | undefined): readonly string[] {
  if (payload === null || payload === undefined) return [];
  const names: string[] = [];
  const walk = (part: MimePart): void => {
    const filename = part.filename ?? '';
    if (filename !== '') names.push(decodeEncodedWords(filename));
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return names;
}
