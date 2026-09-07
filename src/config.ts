import { ConfigError, bool, integer, list, optional, required, type Env } from './env.ts';
import type { RemindFlagMode } from './domain/selector.ts';

export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface AppConfig {
  readonly spreadsheetId: string;
  /** Sheet gids to scan. Empty means "every sheet that has a recognisable header". */
  readonly targetSheetIds: readonly number[];
  readonly logSheetTitle: string;
  readonly senderAddress: string;
  readonly senderName: string;
  readonly bccAddresses: readonly string[];
  readonly offsetDays: number;
  readonly remindFlagMode: RemindFlagMode;
  readonly remindFlagAllowValues: readonly string[];
  readonly remindFlagWriteValue: string;
  readonly writeBackRemindFlag: boolean;
  readonly interviewScheduledValues: readonly string[];
  readonly maxSendsPerRun: number;
  readonly dryRun: boolean;
  readonly credentials: GoogleCredentials;
}

function remindFlagMode(env: Env): RemindFlagMode {
  const raw = optional(env, 'REMIND_FLAG_MODE', 'skipIfMarked');
  if (raw === 'skipIfMarked' || raw === 'requireMarked' || raw === 'ignore') return raw;
  throw new ConfigError(
    `Invalid REMIND_FLAG_MODE: ${raw} (expected skipIfMarked | requireMarked | ignore)`,
  );
}

export function loadConfig(env: Env = process.env): AppConfig {
  const sheetIds = list(env, 'TARGET_SHEET_IDS', []).map((raw) => {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) throw new ConfigError(`Invalid sheet gid in TARGET_SHEET_IDS: ${raw}`);
    return parsed;
  });

  const offsetDays = integer(env, 'REMIND_OFFSET_DAYS', 1);
  if (offsetDays < 0 || offsetDays > 30) {
    throw new ConfigError(`REMIND_OFFSET_DAYS out of range (0-30): ${offsetDays}`);
  }

  const maxSendsPerRun = integer(env, 'MAX_SENDS_PER_RUN', 50);
  if (maxSendsPerRun < 1) throw new ConfigError(`MAX_SENDS_PER_RUN must be >= 1: ${maxSendsPerRun}`);

  return {
    spreadsheetId: required(env, 'SPREADSHEET_ID'),
    targetSheetIds: sheetIds,
    logSheetTitle: optional(env, 'LOG_SHEET_TITLE', '_reminder_log'),
    senderAddress: required(env, 'SENDER_ADDRESS'),
    senderName: optional(env, 'SENDER_NAME', ''),
    bccAddresses: list(env, 'BCC_ADDRESSES', []),
    offsetDays,
    remindFlagMode: remindFlagMode(env),
    remindFlagAllowValues: list(env, 'REMIND_FLAG_ALLOW_VALUES', ['実施', '可', 'TRUE']),
    remindFlagWriteValue: optional(env, 'REMIND_FLAG_WRITE_VALUE', '実施'),
    writeBackRemindFlag: bool(env, 'WRITE_BACK_REMIND_FLAG', true),
    interviewScheduledValues: list(env, 'INTERVIEW_SCHEDULED_VALUES', ['設定済み']),
    maxSendsPerRun,
    // Sending is opt-in: an unset or mis-set DRY_RUN can never mail real candidates.
    dryRun: bool(env, 'DRY_RUN', true),
    credentials: {
      clientId: required(env, 'GOOGLE_CLIENT_ID'),
      clientSecret: required(env, 'GOOGLE_CLIENT_SECRET'),
      refreshToken: required(env, 'GOOGLE_REFRESH_TOKEN'),
    },
  };
}
