import { google, type sheets_v4 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { ReminderTarget, SheetTable } from '../domain/types.ts';
import type { CandidateSource, RemindFlagWriter, SendLog, SentRecord } from '../ports.ts';

const LOG_HEADER = [
  'sent_at_iso',
  'dedupe_key',
  'email',
  'candidate_name',
  'sheet_title',
  'row_number',
  'interview_day',
  'status',
  'detail',
] as const;

const DEDUPE_KEY_COLUMN = 1;
const STATUS_COLUMN = 7;

export interface SheetsRepositoryOptions {
  readonly spreadsheetId: string;
  readonly targetSheetIds: readonly number[];
  readonly logSheetTitle: string;
}

/** Sheets-backed implementation of every spreadsheet-facing port. */
export class SheetsRepository implements CandidateSource, SendLog, RemindFlagWriter {
  readonly #api: sheets_v4.Sheets;
  readonly #options: SheetsRepositoryOptions;
  #logSheetIdCache: number | null = null;

  constructor(auth: OAuth2Client, options: SheetsRepositoryOptions) {
    this.#api = google.sheets({ version: 'v4', auth });
    this.#options = options;
  }

  async loadTables(): Promise<readonly SheetTable[]> {
    // includeGridData with FORMATTED_VALUE gives exactly what a human sees in the cell,
    // which is what the header matcher and the date parser are written against.
    const response = await this.#api.spreadsheets.get({
      spreadsheetId: this.#options.spreadsheetId,
      includeGridData: true,
      fields: 'sheets(properties(sheetId,title,sheetType),data(rowData(values(formattedValue))))',
    });

    const wanted = new Set(this.#options.targetSheetIds);
    const tables: SheetTable[] = [];

    for (const sheet of response.data.sheets ?? []) {
      const properties = sheet.properties;
      const sheetId = properties?.sheetId;
      const title = properties?.title;
      if (typeof sheetId !== 'number' || typeof title !== 'string') continue;
      if (properties?.sheetType !== undefined && properties.sheetType !== 'GRID') continue;
      if (title === this.#options.logSheetTitle) continue;
      if (wanted.size > 0 && !wanted.has(sheetId)) continue;

      const rows = (sheet.data?.[0]?.rowData ?? []).map((row) =>
        (row.values ?? []).map((value) => value.formattedValue ?? ''),
      );
      tables.push({ sheetId, title, rows });
    }

    if (wanted.size > 0) {
      const found = new Set(tables.map((table) => table.sheetId));
      const missing = [...wanted].filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new Error(`TARGET_SHEET_IDS references sheet gids not in the spreadsheet: ${missing.join(', ')}`);
      }
    }
    return tables;
  }

  async loadSentKeys(): Promise<ReadonlySet<string>> {
    const title = this.#options.logSheetTitle;
    let rows: string[][];
    try {
      const response = await this.#api.spreadsheets.values.get({
        spreadsheetId: this.#options.spreadsheetId,
        range: `'${title}'!A:I`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      rows = (response.data.values ?? []) as string[][];
    } catch (error) {
      if (isRangeNotFound(error)) return new Set();
      throw error;
    }

    const keys = new Set<string>();
    for (const row of rows.slice(1)) {
      const key = row[DEDUPE_KEY_COLUMN];
      const status = row[STATUS_COLUMN];
      if (typeof key === 'string' && key !== '' && status === 'sent') keys.add(key);
    }
    return keys;
  }

  async append(records: readonly SentRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.#ensureLogSheet();
    await this.#api.spreadsheets.values.append({
      spreadsheetId: this.#options.spreadsheetId,
      range: `'${this.#options.logSheetTitle}'!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: records.map((record) => [
          record.sentAtIso,
          record.dedupeKey,
          record.email,
          record.candidateName,
          record.sheetTitle,
          String(record.rowNumber),
          record.interviewDay,
          record.status,
          record.detail.slice(0, 500),
        ]),
      },
    });
  }

  async markReminded(targets: readonly ReminderTarget[], value: string): Promise<void> {
    const writable = targets.filter((target) => target.remindFlagColumnIndex !== null);
    if (writable.length === 0) return;

    await this.#api.spreadsheets.batchUpdate({
      spreadsheetId: this.#options.spreadsheetId,
      requestBody: {
        requests: writable.map((target) => ({
          updateCells: {
            // rowNumber is 1-based as shown in the UI; GridRange rows are 0-based.
            range: {
              sheetId: target.sheetId,
              startRowIndex: target.rowNumber - 1,
              endRowIndex: target.rowNumber,
              startColumnIndex: target.remindFlagColumnIndex as number,
              endColumnIndex: (target.remindFlagColumnIndex as number) + 1,
            },
            rows: [{ values: [{ userEnteredValue: { stringValue: value } }] }],
            fields: 'userEnteredValue',
          },
        })),
      },
    });
  }

  async #ensureLogSheet(): Promise<number> {
    if (this.#logSheetIdCache !== null) return this.#logSheetIdCache;

    const meta = await this.#api.spreadsheets.get({
      spreadsheetId: this.#options.spreadsheetId,
      fields: 'sheets(properties(sheetId,title))',
    });
    const existing = (meta.data.sheets ?? []).find(
      (sheet) => sheet.properties?.title === this.#options.logSheetTitle,
    );
    if (existing?.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
      this.#logSheetIdCache = existing.properties.sheetId;
      return this.#logSheetIdCache;
    }

    const created = await this.#api.spreadsheets.batchUpdate({
      spreadsheetId: this.#options.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: this.#options.logSheetTitle, hidden: true } } }],
      },
    });
    const sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (typeof sheetId !== 'number') throw new Error('Failed to create the reminder log sheet.');

    await this.#api.spreadsheets.values.update({
      spreadsheetId: this.#options.spreadsheetId,
      range: `'${this.#options.logSheetTitle}'!A1:I1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[...LOG_HEADER]] },
    });

    this.#logSheetIdCache = sheetId;
    return sheetId;
  }
}

function isRangeNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return status === 400 && typeof message === 'string' && message.includes('Unable to parse range');
}
