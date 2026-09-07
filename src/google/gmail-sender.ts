import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Logger, MailSender, OutgoingMail } from '../ports.ts';

export interface GmailSenderOptions {
  readonly bccAddresses: readonly string[];
  /** Appended to the 担当者's name in the From header, e.g. "新田（株式会社Quad）". */
  readonly senderNameSuffix: string;
}

/** RFC 2047 encoded-word — required for non-ASCII header values such as a Japanese subject. */
function encodeHeader(value: string): string {
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
  const displayName =
    mail.fromDisplayName === ''
      ? options.senderNameSuffix
      : options.senderNameSuffix === ''
        ? mail.fromDisplayName
        : `${mail.fromDisplayName}（${options.senderNameSuffix}）`;

  const headers = [
    `From: ${formatAddress(mail.from, displayName)}`,
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
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

/**
 * Sends each message as its own 担当者 by building one impersonated Gmail client per
 * From address. Clients are cached for the life of the run, so N reminders from the
 * same 担当者 cost one token exchange, not N.
 */
export class ImpersonatingGmailSender implements MailSender {
  readonly #authFor: (subject: string) => OAuth2Client;
  readonly #options: GmailSenderOptions;
  readonly #clients = new Map<string, gmail_v1.Gmail>();

  constructor(authFor: (subject: string) => OAuth2Client, options: GmailSenderOptions) {
    this.#authFor = authFor;
    this.#options = options;
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.#clientFor(mail.from).users.messages.send({
      // 'me' resolves to the impersonated subject, so this really is the 担当者's mailbox.
      userId: 'me',
      requestBody: { raw: buildRawMessage(mail, this.#options) },
    });
  }

  #clientFor(subject: string): gmail_v1.Gmail {
    const cached = this.#clients.get(subject);
    if (cached !== undefined) return cached;
    const client = google.gmail({ version: 'v1', auth: this.#authFor(subject) });
    this.#clients.set(subject, client);
    return client;
  }
}

/** Used by `DRY_RUN=true`; prints what would be sent and delivers nothing. */
export class ConsoleMailSender implements MailSender {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  send(mail: OutgoingMail): Promise<void> {
    this.#logger.info('would send', {
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      body: mail.body,
    });
    return Promise.resolve();
  }
}
