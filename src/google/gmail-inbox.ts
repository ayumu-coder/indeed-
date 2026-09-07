import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { ReceivedMail } from '../domain/mail.ts';
import {
  collectAttachmentNames,
  decodeEncodedWords,
  extractPlainText,
  getHeader,
  parseAddress,
} from '../domain/mime.ts';
import type { Logger, MailInbox } from '../ports.ts';

export interface GmailInboxOptions {
  readonly watchSenders: readonly string[];
  readonly forwardedLabel: string;
  readonly lookbackMinutes: number;
  /** Fetch one more than the run cap, so an overshoot is detectable. */
  readonly maxResults: number;
}

/** Gmail search: sender-scoped, not yet labelled, and time-bounded. */
export function buildSearchQuery(options: GmailInboxOptions, now: Date): string {
  const senders = options.watchSenders.map((address) => `from:${address}`).join(' OR ');
  const afterEpochSeconds = Math.floor(now.getTime() / 1_000) - options.lookbackMinutes * 60;
  return [
    `(${senders})`,
    `-label:"${options.forwardedLabel}"`,
    `after:${String(afterEpochSeconds)}`,
    // Chat and drafts share the message store; neither is inbound mail.
    '-in:chats',
    '-in:drafts',
  ].join(' ');
}

function toReceivedMail(message: gmail_v1.Schema$Message): ReceivedMail {
  const payload = message.payload ?? null;
  const from = decodeEncodedWords(getHeader(payload, 'from'));
  const internalDate = Number(message.internalDate ?? '0');
  return {
    id: message.id ?? '',
    threadId: message.threadId ?? '',
    from,
    fromAddress: parseAddress(from),
    subject: decodeEncodedWords(getHeader(payload, 'subject')).replace(/\s+/g, ' ').trim(),
    receivedAt: new Date(Number.isFinite(internalDate) && internalDate > 0 ? internalDate : Date.now()),
    bodyText: extractPlainText(payload),
    attachmentNames: collectAttachmentNames(payload),
  };
}

export class GmailInbox implements MailInbox {
  readonly #api: gmail_v1.Gmail;
  readonly #options: GmailInboxOptions;
  readonly #logger: Logger;
  #labelId: string | null = null;

  constructor(auth: OAuth2Client, options: GmailInboxOptions, logger: Logger) {
    this.#api = google.gmail({ version: 'v1', auth });
    this.#options = options;
    this.#logger = logger;
  }

  /** Creates the bookkeeping label on first use; idempotent across runs. */
  async ensureLabel(): Promise<string> {
    if (this.#labelId !== null) return this.#labelId;

    const { data } = await this.#api.users.labels.list({ userId: 'me' });
    const existing = (data.labels ?? []).find((label) => label.name === this.#options.forwardedLabel);
    if (existing?.id != null) {
      this.#labelId = existing.id;
      return existing.id;
    }

    const created = await this.#api.users.labels.create({
      userId: 'me',
      requestBody: {
        name: this.#options.forwardedLabel,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    const id = created.data.id;
    if (id == null) throw new Error(`Failed to create Gmail label: ${this.#options.forwardedLabel}`);
    this.#logger.info('created gmail label', { label: this.#options.forwardedLabel, labelId: id });
    this.#labelId = id;
    return id;
  }

  async fetchPending(): Promise<readonly ReceivedMail[]> {
    await this.ensureLabel();
    const query = buildSearchQuery(this.#options, new Date());
    const { data } = await this.#api.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: this.#options.maxResults,
    });

    const ids = (data.messages ?? []).map((message) => message.id).filter((id): id is string => id != null);
    this.#logger.info('gmail search', { query, matched: ids.length });

    const mails: ReceivedMail[] = [];
    for (const id of ids) {
      const { data: message } = await this.#api.users.messages.get({ userId: 'me', id, format: 'full' });
      const mail = toReceivedMail(message);
      // `from:` matches display names and sub-addresses too, so re-check the
      // envelope address exactly. (This is spoofable at the SMTP level — it
      // proves the header, not the sender.)
      if (!this.#options.watchSenders.includes(mail.fromAddress)) {
        this.#logger.warn('skipped: sender mismatch', { id, fromAddress: mail.fromAddress });
        continue;
      }
      mails.push(mail);
    }
    return mails.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  async markForwarded(mailId: string): Promise<void> {
    const labelId = await this.ensureLabel();
    await this.#api.users.messages.modify({
      userId: 'me',
      id: mailId,
      requestBody: { addLabelIds: [labelId] },
    });
  }
}
