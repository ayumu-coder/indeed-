import { ConfigError, bool, integer, list, optional, required, type Env } from './env.ts';
import type { GoogleCredentials } from './config.ts';

/** LINE ids are a 1-letter kind prefix + 32 hex chars: U…=user, C…=group, R…=room. */
const LINE_TARGET_ID = /^[UCR][0-9a-f]{32}$/i;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface ForwardConfig {
  /** Addresses whose mail is forwarded. Compared exactly against the From address. */
  readonly watchSenders: readonly string[];
  readonly lineChannelAccessToken: string;
  readonly lineTo: string;
  /** Display name the target id is expected to belong to; checked by `npm run line:verify`. */
  readonly lineExpectedDisplayName: string;
  /** Gmail label marking a message as already forwarded. Created on first run. */
  readonly forwardedLabel: string;
  /** How far back to look. Bounds the cost of the first run and of a long outage. */
  readonly lookbackMinutes: number;
  readonly bodyMaxChars: number;
  /** Abort the run rather than push more than this — a runaway filter costs money and trust. */
  readonly maxPushesPerRun: number;
  readonly includeGmailLink: boolean;
  /** The `u/<n>` segment of the Gmail deep link; 0 unless the browser is multi-account. */
  readonly gmailUserIndex: number;
  readonly dryRun: boolean;
  readonly credentials: GoogleCredentials;
}

export function loadForwardConfig(env: Env = process.env): ForwardConfig {
  const watchSenders = list(env, 'WATCH_SENDERS', []).map((raw) => raw.toLowerCase());
  if (watchSenders.length === 0) throw new ConfigError('Missing required env var: WATCH_SENDERS');
  for (const sender of watchSenders) {
    if (!EMAIL.test(sender)) throw new ConfigError(`Invalid address in WATCH_SENDERS: ${sender}`);
  }

  const lineTo = required(env, 'LINE_TO');
  if (!LINE_TARGET_ID.test(lineTo)) {
    throw new ConfigError(
      `Invalid LINE_TO: ${lineTo} (expected a userId/groupId/roomId such as U + 32 hex chars)`,
    );
  }

  const lookbackMinutes = integer(env, 'FORWARD_LOOKBACK_MINUTES', 1_440);
  if (lookbackMinutes < 1 || lookbackMinutes > 43_200) {
    throw new ConfigError(`FORWARD_LOOKBACK_MINUTES out of range (1-43200): ${lookbackMinutes}`);
  }

  const bodyMaxChars = integer(env, 'BODY_MAX_CHARS', 700);
  if (bodyMaxChars < 0 || bodyMaxChars > 4_000) {
    throw new ConfigError(`BODY_MAX_CHARS out of range (0-4000): ${bodyMaxChars}`);
  }

  const maxPushesPerRun = integer(env, 'MAX_PUSHES_PER_RUN', 20);
  if (maxPushesPerRun < 1) throw new ConfigError(`MAX_PUSHES_PER_RUN must be >= 1: ${maxPushesPerRun}`);

  const gmailUserIndex = integer(env, 'GMAIL_USER_INDEX', 0);
  if (gmailUserIndex < 0 || gmailUserIndex > 9) {
    throw new ConfigError(`GMAIL_USER_INDEX out of range (0-9): ${gmailUserIndex}`);
  }

  return {
    watchSenders,
    lineChannelAccessToken: required(env, 'LINE_CHANNEL_ACCESS_TOKEN'),
    lineTo,
    lineExpectedDisplayName: optional(env, 'LINE_EXPECTED_DISPLAY_NAME', ''),
    forwardedLabel: optional(env, 'FORWARDED_LABEL', 'LINE転送済み'),
    lookbackMinutes,
    bodyMaxChars,
    maxPushesPerRun,
    includeGmailLink: bool(env, 'INCLUDE_GMAIL_LINK', true),
    gmailUserIndex,
    // Pushing is opt-in, exactly as sending is in the reminder job.
    dryRun: bool(env, 'DRY_RUN', true),
    credentials: {
      clientId: required(env, 'GOOGLE_CLIENT_ID'),
      clientSecret: required(env, 'GOOGLE_CLIENT_SECRET'),
      refreshToken: required(env, 'GOOGLE_REFRESH_TOKEN'),
    },
  };
}
