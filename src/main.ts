import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { createOAuthClient } from './google/auth.ts';
import { SheetsRepository } from './google/sheets-repository.ts';
import { ConsoleMailSender, GmailSender } from './google/gmail-sender.ts';
import { sendReminders } from './usecase/send-reminders.ts';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function loadTemplates(): Promise<{ subject: string; body: string }> {
  const [subject, body] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, 'templates/reminder.subject.txt'), 'utf8'),
    readFile(resolve(PROJECT_ROOT, 'templates/reminder.body.txt'), 'utf8'),
  ]);
  return { subject, body };
}

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadConfig();
  const templates = await loadTemplates();

  const auth = createOAuthClient(config.credentials);
  const repository = new SheetsRepository(auth, {
    spreadsheetId: config.spreadsheetId,
    targetSheetIds: config.targetSheetIds,
    logSheetTitle: config.logSheetTitle,
  });

  const sender = config.dryRun
    ? new ConsoleMailSender(logger)
    : new GmailSender(auth, {
        senderAddress: config.senderAddress,
        senderName: config.senderName,
        bccAddresses: config.bccAddresses,
      });

  const report = await sendReminders(
    {
      source: repository,
      sender,
      sendLog: repository,
      flagWriter: config.writeBackRemindFlag && !config.dryRun ? repository : null,
      clock: { now: () => new Date() },
      logger,
    },
    {
      offsetDays: config.offsetDays,
      remindFlagMode: config.remindFlagMode,
      remindFlagAllowValues: config.remindFlagAllowValues,
      interviewScheduledValues: config.interviewScheduledValues,
      remindFlagWriteValue: config.remindFlagWriteValue,
      templates,
      dryRun: config.dryRun,
      maxSendsPerRun: config.maxSendsPerRun,
    },
  );

  logger.info('run complete', {
    targetDay: report.targetDay,
    considered: report.considered,
    sent: report.sent,
    failed: report.failed,
    dryRun: report.dryRun,
  });

  // A partial failure must surface as a red workflow run, not a green one.
  if (report.failed > 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  createLogger(process.stderr).error('fatal', {
    detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exitCode = 1;
});
