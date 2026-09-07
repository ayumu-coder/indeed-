import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Logger, MailSender, OutgoingMail } from '../ports.ts';

export interface GmailSenderOptions {
  readonly senderAddress: string;
  readonly senderName: string;
  readonly bccAddresses: readonly string[];
}

/** RFC 2047 encoded-word — required for non-ASCII header values such as a Japanese subject. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Strips CR/LF so a value can never inject additional headers. */
function sanitiseHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function formatAddress(address: string, displayName: string): string {
  const safeAddress = sanitiseHeaderValue(address);
  if (displayName === '') return safeAddress;
  return `${encodeHeader(sanitiseHeaderValue(displayName))} <${safeAddress}>`;
}

export function buildRawMessage(mail: OutgoingMail, options: GmailSenderOptions): string {
  const headers = [
    `From: ${formatAddress(options.senderAddress, options.senderName)}`,
    `To: ${sanitiseHeaderValue(mail.to)}`,
    ...(options.bccAddresses.length > 0
      ? [`Bcc: ${options.bccAddresses.map(sanitiseHeaderValue).join(', ')}`]
      : []),
    `Subject: ${encodeHeader(sanitiseHeaderValue(mail.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const body = Buffer.from(mail.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const message = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(message, 'utf8').toString('base64url');
}

export class GmailSender implements MailSender {
  readonly #api: gmail_v1.Gmail;
  readonly #options: GmailSenderOptions;

  constructor(auth: OAuth2Client, options: GmailSenderOptions) {
    this.#api = google.gmail({ version: 'v1', auth });
    this.#options = options;
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.#api.users.messages.send({
      userId: 'me',
      requestBody: { raw: buildRawMessage(mail, this.#options) },
    });
  }
}

/** Used by `DRY_RUN=true`; prints what would be sent and delivers nothing. */
export class ConsoleMailSender implements MailSender {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  send(mail: OutgoingMail): Promise<void> {
    this.#logger.info('would send', { to: mail.to, subject: mail.subject, body: mail.body });
    return Promise.resolve();
  }
}
