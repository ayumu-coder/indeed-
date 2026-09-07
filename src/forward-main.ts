import { loadForwardConfig } from './forward-config.ts';
import { createLogger } from './logger.ts';
import { createOAuthClient } from './google/auth.ts';
import { GmailInbox } from './google/gmail-inbox.ts';
import { ConsoleNotifier, DEFAULT_LINE_OPTIONS, LinePushNotifier } from './line/line-notifier.ts';
import { forwardMailToLine } from './usecase/forward-mail-to-line.ts';

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadForwardConfig();

  const auth = createOAuthClient(config.credentials);
  const inbox = new GmailInbox(
    auth,
    {
      watchSenders: config.watchSenders,
      forwardedLabel: config.forwardedLabel,
      lookbackMinutes: config.lookbackMinutes,
      // One over the cap, so an overshoot is detected instead of silently trimmed.
      maxResults: config.maxPushesPerRun + 1,
    },
    logger,
  );

  const notifier = config.dryRun
    ? new ConsoleNotifier(logger)
    : new LinePushNotifier(
        {
          channelAccessToken: config.lineChannelAccessToken,
          to: config.lineTo,
          maxAttempts: DEFAULT_LINE_OPTIONS.maxAttempts,
          baseDelayMs: DEFAULT_LINE_OPTIONS.baseDelayMs,
        },
        logger,
      );

  const report = await forwardMailToLine(
    { inbox, notifier, logger },
    {
      bodyMaxChars: config.bodyMaxChars,
      maxPushesPerRun: config.maxPushesPerRun,
      includeGmailLink: config.includeGmailLink,
      gmailUserIndex: config.gmailUserIndex,
      dryRun: config.dryRun,
    },
  );

  logger.info('run complete', {
    pending: report.pending,
    pushed: report.pushed,
    failed: report.failed,
    dryRun: report.dryRun,
  });
  if (report.failed > 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  createLogger(process.stderr).error('fatal', {
    detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exitCode = 1;
});
