import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ConfigError, loadConfig, type AppConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { createImpersonatedGmailAuth, createSheetsAuth } from './google/auth.ts';
import { SheetsRepository } from './google/sheets-repository.ts';
import {
  ConsoleMailSender,
  ImpersonatingGmailSender,
  listVerifiedSendAsAddresses,
} from './google/gmail-sender.ts';
import { sendReminders } from './usecase/send-reminders.ts';
import type { MailSender } from './ports.ts';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function loadTemplates(): Promise<{ subject: string; body: string }> {
  const [subject, body] = await Promise.all([
    readFile(resolve(PROJECT_ROOT, 'templates/reminder.subject.txt'), 'utf8'),
    readFile(resolve(PROJECT_ROOT, 'templates/reminder.body.txt'), 'utf8'),
  ]);
  return { subject, body };
}

function createSender(config: AppConfig, logger: ReturnType<typeof createLogger>): MailSender {
  if (config.dryRun) return new ConsoleMailSender(logger);

  const auth = config.auth;
  const options = {
    bccAddresses: config.bccAddresses,
    senderNameSuffix: config.senderNameSuffix,
  };

  if (auth.mode === 'serviceAccount') {
    return new ImpersonatingGmailSender((subject) => createImpersonatedGmailAuth(auth, subject), options);
  }
  // OAuth mode: config validation has already guaranteed every reminder resolves to the
  // single authorised address, so one client serves them all.
  const client = createSheetsAuth(auth);
  return new ImpersonatingGmailSender(() => client, options);
}

/**
 * Resolves which From addresses the account may actually use. In service-account mode
 * each 担当者 is impersonated directly, so there is nothing to check.
 */
async function loadAllowedFromAddresses(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
): Promise<ReadonlySet<string> | null> {
  if (!config.verifySendAsAliases || config.dryRun) return null;
  if (config.auth.mode === 'serviceAccount') return null;

  try {
    const addresses = await listVerifiedSendAsAddresses(createSheetsAuth(config.auth));
    logger.info('verified send-as addresses', { addresses });
    return new Set(addresses);
  } catch (error) {
    // Missing the settings scope must not block delivery: an unverified alias still
    // fails loudly at send time.
    logger.warn('could not read send-as aliases; skipping the pre-flight check', {
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadConfig();
  const templates = await loadTemplates();

  const repository = new SheetsRepository(createSheetsAuth(config.auth), {
    spreadsheetId: config.spreadsheetId,
    targetSheetIds: config.targetSheetIds,
    logSheetTitle: config.logSheetTitle,
  });

  const report = await sendReminders(
    {
      source: repository,
      sender: createSender(config, logger),
      sendLog: repository,
      flagWriter: config.writeBackRemindFlag && !config.dryRun ? repository : null,
      markerWriter: config.writeSentMarker && !config.dryRun ? repository : null,
      allowedFromAddresses: await loadAllowedFromAddresses(config, logger),
      clock: { now: () => new Date() },
      logger,
    },
    {
      offsetDays: config.offsetDays,
      remindFlagMode: config.remindFlagMode,
      remindFlagAllowValues: config.remindFlagAllowValues,
      interviewScheduledValues: config.interviewScheduledValues,
      remindFlagWriteValue: config.remindFlagWriteValue,
      sentMarkerPrefix: config.sentMarkerPrefix,
      senderPolicy: {
        ownerEmails: config.ownerEmails,
        defaultAddress: config.defaultSenderAddress,
        fallbackToDefault: config.fallbackToDefaultSender,
      },
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
    unmappedOwners: report.unmappedOwners,
    unverifiedSenders: report.unverifiedSenders,
    dryRun: report.dryRun,
  });

  // A delivery failure, a missing 担当者 address and an unverified alias all mean
  // somebody did not get a reminder they should have. Surface that as a red run.
  const blocked =
    report.failed > 0 || report.unmappedOwners.length > 0 || report.unverifiedSenders.length > 0;
  if (blocked) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  const logger = createLogger(process.stderr);
  if (error instanceof ConfigError) logger.error('configuration error', { detail: error.message });
  else {
    logger.error('fatal', {
      detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
  process.exitCode = 1;
});
