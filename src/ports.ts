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
  readonly from: string;
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

/** Prepends the 送信済 stamp to 面接詳細, preserving whatever the column already held. */
export interface SentMarkerWriter {
  writeSentMarkers(entries: readonly SentMarkerEntry[]): Promise<void>;
}

export interface SentMarkerEntry {
  readonly target: ReminderTarget;
  readonly stamp: string;
}

export interface OutgoingMail {
  /** The 担当者's own address; the message is sent as this user. */
  readonly from: string;
  readonly fromDisplayName: string;
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
