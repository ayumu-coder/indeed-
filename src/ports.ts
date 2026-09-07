import type { ReminderTarget, SheetTable } from './domain/types.ts';

/** Reads the candidate sheets. */
export interface CandidateSource {
  loadTables(): Promise<readonly SheetTable[]>;
}

export interface SentRecord {
  readonly sentAtIso: string;
  readonly dedupeKey: string;
  readonly email: string;
  readonly candidateName: string;
  readonly sheetTitle: string;
  readonly rowNumber: number;
  readonly interviewDay: string;
  readonly status: 'sent' | 'failed' | 'dry-run';
  readonly detail: string;
}

/** Durable record of what has already gone out, so re-runs cannot double-send. */
export interface SendLog {
  loadSentKeys(): Promise<ReadonlySet<string>>;
  append(records: readonly SentRecord[]): Promise<void>;
}

/** Optional write-back of the リマインド可否 column. */
export interface RemindFlagWriter {
  markReminded(targets: readonly ReminderTarget[], value: string): Promise<void>;
}

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface MailSender {
  send(mail: OutgoingMail): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}
