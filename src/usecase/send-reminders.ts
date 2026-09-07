import { addDays, toJstDay } from '../domain/jst.ts';
import { selectTargets, type RemindFlagMode } from '../domain/selector.ts';
import { renderMail } from '../domain/template.ts';
import { resolveSender, type SenderPolicy } from '../domain/sender.ts';
import type { ReminderTarget, SkippedRow } from '../domain/types.ts';
import type {
  CandidateSource,
  Clock,
  Logger,
  MailSender,
  RemindFlagWriter,
  SendLog,
  SentRecord,
} from '../ports.ts';

export interface SendRemindersDeps {
  readonly source: CandidateSource;
  readonly sender: MailSender;
  readonly sendLog: SendLog;
  readonly flagWriter: RemindFlagWriter | null;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface SendRemindersOptions {
  readonly offsetDays: number;
  readonly remindFlagMode: RemindFlagMode;
  readonly remindFlagAllowValues: readonly string[];
  readonly interviewScheduledValues: readonly string[];
  readonly remindFlagWriteValue: string;
  readonly senderPolicy: SenderPolicy;
  readonly templates: { readonly subject: string; readonly body: string };
  readonly dryRun: boolean;
  /** Hard ceiling on messages per run; guards against a bad column map fanning out. */
  readonly maxSendsPerRun: number;
}

export interface SendRemindersReport {
  readonly targetDay: string;
  readonly considered: number;
  readonly sent: number;
  readonly failed: number;
  /** 担当者 names present in the sheet with no address configured for them. */
  readonly unmappedOwners: readonly string[];
  readonly skipped: readonly SkippedRow[];
  readonly dryRun: boolean;
}

function summariseSkips(skipped: readonly SkippedRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of skipped) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}

export async function sendReminders(
  deps: SendRemindersDeps,
  options: SendRemindersOptions,
): Promise<SendRemindersReport> {
  const now = deps.clock.now();
  const targetDay = addDays(toJstDay(now), options.offsetDays);

  const [tables, alreadySent] = await Promise.all([
    deps.source.loadTables(),
    deps.sendLog.loadSentKeys(),
  ]);

  const { targets, skipped } = selectTargets(tables, {
    now,
    offsetDays: options.offsetDays,
    remindFlagMode: options.remindFlagMode,
    remindFlagAllowValues: options.remindFlagAllowValues,
    interviewScheduledValues: options.interviewScheduledValues,
    alreadySent,
  });

  deps.logger.info('selection complete', {
    targetDay,
    sheets: tables.length,
    targets: targets.length,
    skips: summariseSkips(skipped),
  });

  if (targets.length > options.maxSendsPerRun) {
    throw new Error(
      `Refusing to send: ${targets.length} targets exceeds MAX_SENDS_PER_RUN=${options.maxSendsPerRun}. ` +
        'Verify the sheet and the column mapping before raising the limit.',
    );
  }

  const records: SentRecord[] = [];
  const delivered: ReminderTarget[] = [];
  const unmappedOwners = new Set<string>();
  const senderSkips: SkippedRow[] = [];
  let failed = 0;

  for (const target of targets) {
    const sender = resolveSender(target.owner, options.senderPolicy);
    if (sender.kind === 'unmapped') {
      // Never fall back to somebody else's address: a reminder that appears to come
      // from the wrong 担当者 is worse than one that is not sent.
      unmappedOwners.add(sender.owner);
      senderSkips.push({
        sheetTitle: target.sheetTitle,
        rowNumber: target.rowNumber,
        candidateName: target.candidateName,
        reason: 'owner-not-mapped',
      });
      deps.logger.error('no sender address for 担当者', {
        owner: sender.owner,
        row: target.rowNumber,
        candidate: target.candidateName,
      });
      continue;
    }

    const mail = renderMail(options.templates, target);
    const base = {
      sentAtIso: new Date().toISOString(),
      dedupeKey: target.dedupeKey,
      email: target.email,
      candidateName: target.candidateName,
      sheetTitle: target.sheetTitle,
      rowNumber: target.rowNumber,
      interviewDay: target.interviewDay,
      from: sender.address,
    } as const;

    if (options.dryRun) {
      deps.logger.info('dry-run', { from: sender.address, to: target.email, subject: mail.subject });
      records.push({ ...base, status: 'dry-run', detail: mail.subject });
      continue;
    }

    try {
      await deps.sender.send({
        from: sender.address,
        fromDisplayName: sender.displayName,
        to: target.email,
        subject: mail.subject,
        body: mail.body,
      });
      delivered.push(target);
      records.push({ ...base, status: 'sent', detail: mail.subject });
      deps.logger.info('sent', { from: sender.address, to: target.email, row: target.rowNumber });
    } catch (error) {
      failed += 1;
      const detail = error instanceof Error ? error.message : String(error);
      records.push({ ...base, status: 'failed', detail });
      deps.logger.error('send failed', { to: target.email, row: target.rowNumber, detail });
    }
  }

  // The log is appended even for dry runs and failures so every run leaves an audit
  // trail; only 'sent' rows are replayed as dedupe keys on the next run.
  if (records.length > 0) await deps.sendLog.append(records);

  if (deps.flagWriter !== null && delivered.length > 0) {
    try {
      await deps.flagWriter.markReminded(delivered, options.remindFlagWriteValue);
    } catch (error) {
      // Write-back is bookkeeping, not delivery. The send log already prevents a
      // duplicate send, so a failure here must not fail the run.
      deps.logger.warn('remind-flag write-back failed', {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    targetDay,
    considered: targets.length,
    sent: delivered.length,
    failed,
    unmappedOwners: [...unmappedOwners],
    skipped: [...skipped, ...senderSkips],
    dryRun: options.dryRun,
  };
}
