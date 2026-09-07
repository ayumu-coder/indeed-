import { formatJapanese, formatJstTime, toJstDay } from './jst.ts';
import type { ReceivedMail } from './mail.ts';

/** Hard limit of a LINE text message. Exceeding it is a 400, not a truncation. */
export const LINE_TEXT_MAX_CHARS = 5000;

export interface LineMessageOptions {
  /** How much of the mail body to include before eliding. */
  readonly bodyMaxChars: number;
  /** Deep link back to the thread in Gmail, or null to omit it. */
  readonly gmailLink: string | null;
}

const ELLIPSIS = '…';

/**
 * Truncates by code point, not by UTF-16 unit: slicing a surrogate pair in half
 * produces a lone surrogate, which LINE rejects as invalid UTF-8.
 */
export function truncateByCodePoints(text: string, max: number): string {
  if (max <= 0) return '';
  const points = Array.from(text);
  if (points.length <= max) return text;
  return `${points.slice(0, Math.max(0, max - 1)).join('')}${ELLIPSIS}`;
}

export function gmailThreadUrl(threadId: string, userIndex: number): string {
  return `https://mail.google.com/mail/u/${String(userIndex)}/#all/${encodeURIComponent(threadId)}`;
}

/** The notification text pushed to LINE. Deterministic — snapshot-testable. */
export function buildLineText(mail: ReceivedMail, options: LineMessageOptions): string {
  const receivedDay = toJstDay(mail.receivedAt);
  const lines: string[] = [
    '📩 新着メール',
    `差出人: ${mail.from === '' ? mail.fromAddress : mail.from}`,
    `件名: ${mail.subject === '' ? '(件名なし)' : mail.subject}`,
    `受信: ${formatJapanese(receivedDay)} ${formatJstTime(mail.receivedAt)}`,
  ];
  if (mail.attachmentNames.length > 0) {
    lines.push(`添付: ${mail.attachmentNames.join(', ')}`);
  }

  const body = truncateByCodePoints(mail.bodyText, options.bodyMaxChars);
  lines.push('──────────', body === '' ? '(本文なし)' : body);

  if (options.gmailLink !== null) lines.push('──────────', options.gmailLink);

  return truncateByCodePoints(lines.join('\n'), LINE_TEXT_MAX_CHARS);
}
