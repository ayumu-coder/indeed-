import type { RemindFlagMode } from './domain/selector.ts';
import { buildOwnerEmailMap } from './domain/sender.ts';

export interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
}

export type GoogleAuthConfig =
  | { readonly mode: 'serviceAccount'; readonly key: ServiceAccountKey }
  | {
      readonly mode: 'oauth';
      readonly clientId: string;
      readonly clientSecret: string;
      readonly refreshToken: string;
    };

export interface AppConfig {
  readonly spreadsheetId: string;
  readonly targetSheetIds: readonly number[];
  readonly logSheetTitle: string;
  /** 担当者名 → 送信元アドレス. */
  readonly ownerEmails: ReadonlyMap<string, string>;
  /** Used for a blank 担当者, and for unmapped ones when the fallback is enabled. */
  readonly defaultSenderAddress: string | null;
  readonly fallbackToDefaultSender: boolean;
  readonly senderNameSuffix: string;
  readonly bccAddresses: readonly string[];
  readonly offsetDays: number;
  readonly remindFlagMode: RemindFlagMode;
  readonly remindFlagAllowValues: readonly string[];
  readonly remindFlagWriteValue: string;
  readonly writeBackRemindFlag: boolean;
  readonly interviewScheduledValues: readonly string[];
  /** 面接詳細 starting with this text means "already reminded". Empty disables the check. */
  readonly sentMarkerPrefix: string;
  /** Prepend the 送信済 stamp to 面接詳細 after sending, as the Apps Script did. */
  readonly writeSentMarker: boolean;
  /** Check each From address against the account's verified send-as aliases before sending. */
  readonly verifySendAsAliases: boolean;
  readonly maxSendsPerRun: number;
  readonly dryRun: boolean;
  readonly auth: GoogleAuthConfig;
}

export class ConfigError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === '') throw new ConfigError(`Missing required env var: ${key}`);
  return value;
}

function optional(env: Env, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value === undefined || value === '' ? fallback : value;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`Invalid boolean for ${key}: ${raw}`);
}

function integer(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new ConfigError(`Invalid integer for ${key}: ${raw}`);
  return parsed;
}

function list(env: Env, key: string, fallback: readonly string[]): readonly string[] {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (raw.trim() === '') return [];
  return raw.split(',').map((item) => item.trim()).filter((item) => item !== '');
}

function remindFlagMode(env: Env): RemindFlagMode {
  const raw = optional(env, 'REMIND_FLAG_MODE', 'requireMarked');
  if (raw === 'skipIfMarked' || raw === 'requireMarked' || raw === 'ignore') return raw;
  throw new ConfigError(
    `Invalid REMIND_FLAG_MODE: ${raw} (expected skipIfMarked | requireMarked | ignore)`,
  );
}

function parseServiceAccountKey(raw: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ConfigError('GOOGLE_SERVICE_ACCOUNT_KEY must be a JSON object.');
  }
  const { client_email: email, private_key: key } = parsed as Record<string, unknown>;
  if (typeof email !== 'string' || email === '') {
    throw new ConfigError('GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email.');
  }
  if (typeof key !== 'string' || key === '') {
    throw new ConfigError('GOOGLE_SERVICE_ACCOUNT_KEY is missing private_key.');
  }
  // GitHub Actions secrets frequently arrive with literal \n instead of real newlines.
  return { client_email: email, private_key: key.replace(/\\n/g, '\n') };
}

function loadAuth(env: Env): GoogleAuthConfig {
  const serviceAccount = env['GOOGLE_SERVICE_ACCOUNT_KEY']?.trim();
  if (serviceAccount !== undefined && serviceAccount !== '') {
    return { mode: 'serviceAccount', key: parseServiceAccountKey(serviceAccount) };
  }
  return {
    mode: 'oauth',
    clientId: required(env, 'GOOGLE_CLIENT_ID'),
    clientSecret: required(env, 'GOOGLE_CLIENT_SECRET'),
    refreshToken: required(env, 'GOOGLE_REFRESH_TOKEN'),
  };
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

  const auth = loadAuth(env);
  const ownerEmails = buildOwnerEmailMap(list(env, 'OWNER_EMAIL_MAP', []));
  const defaultSender = optional(env, 'DEFAULT_SENDER_ADDRESS', '');

  if (ownerEmails.size === 0 && defaultSender === '') {
    throw new ConfigError('Set OWNER_EMAIL_MAP (担当者名:address,...) and/or DEFAULT_SENDER_ADDRESS.');
  }

  return {
    spreadsheetId: required(env, 'SPREADSHEET_ID'),
    targetSheetIds: sheetIds,
    logSheetTitle: optional(env, 'LOG_SHEET_TITLE', '_reminder_log'),
    ownerEmails,
    defaultSenderAddress: defaultSender === '' ? null : defaultSender,
    // Off by default: a reminder from the wrong 担当者 is worse than one not sent.
    fallbackToDefaultSender: bool(env, 'FALLBACK_TO_DEFAULT_SENDER', false),
    senderNameSuffix: optional(env, 'SENDER_NAME_SUFFIX', '株式会社Quad'),
    bccAddresses: list(env, 'BCC_ADDRESSES', []),
    offsetDays,
    remindFlagMode: remindFlagMode(env),
    remindFlagAllowValues: list(env, 'REMIND_FLAG_ALLOW_VALUES', ['実施', '可', 'TRUE']),
    remindFlagWriteValue: optional(env, 'REMIND_FLAG_WRITE_VALUE', '実施'),
    // リマインド可否 is an operator input, not an output — do not overwrite it by default.
    writeBackRemindFlag: bool(env, 'WRITE_BACK_REMIND_FLAG', false),
    interviewScheduledValues: list(env, 'INTERVIEW_SCHEDULED_VALUES', ['設定済み']),
    sentMarkerPrefix: optional(env, 'SENT_MARKER_PREFIX', '送信済'),
    writeSentMarker: bool(env, 'WRITE_SENT_MARKER', true),
    verifySendAsAliases: bool(env, 'VERIFY_SEND_AS_ALIASES', true),
    maxSendsPerRun,
    dryRun: bool(env, 'DRY_RUN', true),
    auth,
  };
}
