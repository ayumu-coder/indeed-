import { addDays, toJstDay, type JstDay } from './jst.ts';
import { locateHeader, type ColumnKey, type ColumnMap } from './columns.ts';
import { parseSheetDate } from './sheet-date.ts';
import type { ReminderTarget, SelectionResult, SheetTable, SkipReason, SkippedRow } from './types.ts';

/**
 * How the リマインド可否 column gates a row.
 * - `skipIfMarked`  : a non-empty cell means the reminder was already handled — skip it.
 *                     Safe default: it can only ever suppress a send, never cause one.
 * - `requireMarked` : only rows whose cell matches `remindFlagAllowValues` are sent.
 * - `ignore`        : the column is not consulted at all.
 */
export type RemindFlagMode = 'skipIfMarked' | 'requireMarked' | 'ignore';

export interface SelectionOptions {
  readonly now: Date;
  /** Send to interviews this many calendar days ahead. 1 = tomorrow. */
  readonly offsetDays: number;
  readonly remindFlagMode: RemindFlagMode;
  readonly remindFlagAllowValues: readonly string[];
  /** Values of 面接設定可否 that count as "the interview is booked". Empty = do not gate. */
  readonly interviewScheduledValues: readonly string[];
  /** Dedupe keys already recorded as sent by a previous run. */
  readonly alreadySent: ReadonlySet<string>;
}

/**
 * Deliberately conservative: it rejects anything with a display name, angle brackets or
 * whitespace so a malformed cell can never widen the recipient list.
 */
const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[A-Za-z]{2,}$/;

export function isSendableEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

function cell(row: readonly string[], columns: ColumnMap, key: ColumnKey): string {
  const index = columns[key];
  if (index === undefined) return '';
  return (row[index] ?? '').trim();
}

export function makeDedupeKey(email: string, day: JstDay, offsetDays: number): string {
  return `${email.trim().toLowerCase()}|${day}|d-${offsetDays}`;
}

export function selectTargets(
  tables: readonly SheetTable[],
  options: SelectionOptions,
): SelectionResult {
  const targetDay = addDays(toJstDay(options.now), options.offsetDays);
  const targets: ReminderTarget[] = [];
  const skipped: SkippedRow[] = [];
  const seenInBatch = new Set<string>();

  const skip = (sheetTitle: string, rowNumber: number, candidateName: string, reason: SkipReason): void => {
    skipped.push({ sheetTitle, rowNumber, candidateName, reason });
  };

  for (const table of tables) {
    const header = locateHeader(table.rows);
    if (header === null) {
      skip(table.title, 0, '', 'no-header');
      continue;
    }
    const { columns } = header;

    for (let i = header.rowIndex + 1; i < table.rows.length; i += 1) {
      const row = table.rows[i];
      const rowNumber = i + 1;
      if (row === undefined || row.every((value) => (value ?? '').trim() === '')) continue;

      const candidateName = cell(row, columns, 'candidateName');
      const email = cell(row, columns, 'email');
      const rawInterviewAt = cell(row, columns, 'interviewAt');

      if (candidateName === '' && email === '' && rawInterviewAt === '') {
        skip(table.title, rowNumber, candidateName, 'blank-row');
        continue;
      }

      // Date first: it is the cheapest gate and rejects the overwhelming majority of rows.
      const interview = parseSheetDate(rawInterviewAt, options.now);
      if (interview === null) {
        skip(table.title, rowNumber, candidateName, 'unparsable-interview-date');
        continue;
      }
      if (interview.day !== targetDay) {
        skip(table.title, rowNumber, candidateName, 'not-in-window');
        continue;
      }

      if (email === '') {
        skip(table.title, rowNumber, candidateName, 'missing-email');
        continue;
      }
      if (!isSendableEmail(email)) {
        skip(table.title, rowNumber, candidateName, 'invalid-email');
        continue;
      }

      if (options.interviewScheduledValues.length > 0) {
        const scheduled = cell(row, columns, 'interviewScheduled');
        if (!options.interviewScheduledValues.includes(scheduled)) {
          skip(table.title, rowNumber, candidateName, 'interview-not-scheduled');
          continue;
        }
      }

      const remindFlag = cell(row, columns, 'remindFlag');
      const blockedByFlag =
        options.remindFlagMode === 'skipIfMarked'
          ? remindFlag !== ''
          : options.remindFlagMode === 'requireMarked'
            ? !options.remindFlagAllowValues.includes(remindFlag)
            : false;
      if (blockedByFlag) {
        skip(table.title, rowNumber, candidateName, 'remind-flag-blocked');
        continue;
      }

      const dedupeKey = makeDedupeKey(email, interview.day, options.offsetDays);
      if (options.alreadySent.has(dedupeKey)) {
        skip(table.title, rowNumber, candidateName, 'already-sent');
        continue;
      }
      if (seenInBatch.has(dedupeKey)) {
        skip(table.title, rowNumber, candidateName, 'duplicate-in-batch');
        continue;
      }
      seenInBatch.add(dedupeKey);

      targets.push({
        sheetId: table.sheetId,
        sheetTitle: table.title,
        rowNumber,
        candidateName,
        email: email.trim(),
        company: cell(row, columns, 'company'),
        jobTitle: cell(row, columns, 'jobTitle'),
        owner: cell(row, columns, 'owner'),
        interviewDay: interview.day,
        interviewTime: interview.timeOfDay,
        remindFlagColumnIndex: columns.remindFlag ?? null,
        dedupeKey,
      });
    }
  }

  return { targets, skipped };
}
