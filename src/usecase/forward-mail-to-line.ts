import { buildLineText, gmailThreadUrl } from '../domain/line-message.ts';
import { deterministicRetryKey } from '../line/retry-key.ts';
import type { Logger, MailInbox, Notifier } from '../ports.ts';

export interface ForwardDeps {
  readonly inbox: MailInbox;
  readonly notifier: Notifier;
  readonly logger: Logger;
}

export interface ForwardOptions {
  readonly bodyMaxChars: number;
  readonly maxPushesPerRun: number;
  readonly includeGmailLink: boolean;
  readonly gmailUserIndex: number;
  /** Pushes go to the console and nothing is labelled, so the run repeats identically. */
  readonly dryRun: boolean;
}

export interface ForwardReport {
  readonly pending: number;
  readonly pushed: number;
  readonly failed: number;
  readonly dryRun: boolean;
}

export class TooManyPendingMailsError extends Error {}

/**
 * Pushes each unforwarded mail to LINE, then labels it.
 *
 * Ordering is deliberate: push first, label second. A crash between the two
 * re-sends one notification on the next run, which is the acceptable failure —
 * labelling first would silently swallow a mail whose push never happened.
 */
export async function forwardMailToLine(
  deps: ForwardDeps,
  options: ForwardOptions,
): Promise<ForwardReport> {
  const pending = await deps.inbox.fetchPending();

  if (pending.length > options.maxPushesPerRun) {
    throw new TooManyPendingMailsError(
      `${String(pending.length)} mails matched but MAX_PUSHES_PER_RUN is ${String(options.maxPushesPerRun)}; ` +
        'nothing was pushed. Widen the cap deliberately or narrow WATCH_SENDERS.',
    );
  }

  let pushed = 0;
  let failed = 0;

  for (const mail of pending) {
    const text = buildLineText(mail, {
      bodyMaxChars: options.bodyMaxChars,
      gmailLink: options.includeGmailLink ? gmailThreadUrl(mail.threadId, options.gmailUserIndex) : null,
    });

    try {
      await deps.notifier.push(text, deterministicRetryKey(mail.id));
    } catch (error: unknown) {
      failed += 1;
      deps.logger.error('push failed', {
        id: mail.id,
        subject: mail.subject,
        detail: error instanceof Error ? error.message : String(error),
      });
      // An expired token or a blocked bot fails identically for every remaining
      // mail; stopping keeps the log readable and the retry cheap.
      break;
    }

    pushed += 1;
    deps.logger.info('pushed', { id: mail.id, subject: mail.subject, receivedAt: mail.receivedAt.toISOString() });

    if (options.dryRun) continue;

    try {
      await deps.inbox.markForwarded(mail.id);
    } catch (error: unknown) {
      // The label is the dedupe store. If it cannot be written, every later run
      // re-sends this mail, so stop now and surface it rather than loop.
      deps.logger.error('label write failed after push', {
        id: mail.id,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return { pending: pending.length, pushed, failed, dryRun: options.dryRun };
}
