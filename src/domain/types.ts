import type { JstDay } from './jst.ts';
import type { ColumnMap } from './columns.ts';

/** One sheet tab, read verbatim as a grid of display strings. */
export interface SheetTable {
  readonly sheetId: number;
  readonly title: string;
  readonly rows: readonly (readonly string[])[];
}

/** A row that passed every gate and should receive a reminder. */
export interface ReminderTarget {
  readonly sheetId: number;
  readonly sheetTitle: string;
  /** 1-based row number as shown in the spreadsheet UI. */
  readonly rowNumber: number;
  readonly candidateName: string;
  readonly email: string;
  readonly company: string;
  readonly jobTitle: string;
  readonly owner: string;
  readonly interviewDay: JstDay;
  readonly interviewTime: string | null;
  /** 0-based index of the リマインド可否 column, when the sheet has one. */
  readonly remindFlagColumnIndex: number | null;
  /** Stable identity used to suppress duplicate sends across runs. */
  readonly dedupeKey: string;
}

export type SkipReason =
  | 'no-header'
  | 'blank-row'
  | 'unparsable-interview-date'
  | 'not-in-window'
  | 'missing-email'
  | 'invalid-email'
  | 'interview-not-scheduled'
  | 'remind-flag-blocked'
  | 'already-sent'
  | 'duplicate-in-batch';

export interface SkippedRow {
  readonly sheetTitle: string;
  readonly rowNumber: number;
  readonly candidateName: string;
  readonly reason: SkipReason;
}

export interface SelectionResult {
  readonly targets: readonly ReminderTarget[];
  readonly skipped: readonly SkippedRow[];
}

export interface SheetWithHeader {
  readonly table: SheetTable;
  readonly headerRowIndex: number;
  readonly columns: ColumnMap;
}
