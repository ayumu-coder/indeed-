import { FIELDS, COLUMN_COUNT, type FieldKey } from './schema.ts';
import { readZip, writeZip, type ZipEntry } from './zip.ts';

/**
 * Fills the official Indeed template rather than generating a workbook from scratch: the
 * header row, the 例 tab and the 入力方法 tab survive untouched, so what Indeed's importer
 * receives differs from the file they published only by the rows we appended.
 */

export class WorkbookError extends Error {}

/** The 求人入力シート tab. Indeed's importer reads the first sheet. */
const DATA_SHEET_PATH = 'xl/worksheets/sheet1.xml';
const HEADER_ROW = 1;

export function columnLetter(index: number): string {
  if (index < 0) throw new WorkbookError(`Column index out of range: ${index}`);
  let letter = '';
  for (let remaining = index; remaining >= 0; remaining = Math.floor(remaining / 26) - 1) {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter;
  }
  return letter;
}

/** Tab, LF and CR are the only control characters XML 1.0 permits; the rest must go. */
function stripIllegalXmlChars(value: string): string {
  let kept = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) kept += char;
  }
  return kept;
}

export function escapeXml(value: string): string {
  return stripIllegalXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Row values, keyed by field. Missing or empty entries become blank cells. */
export type SheetRow = ReadonlyMap<FieldKey, readonly string[]>;

function cellsFor(row: SheetRow, rowNumber: number): string {
  const cells: string[] = [];
  let column = 0;

  for (const spec of FIELDS) {
    const values = row.get(spec.key) ?? [];
    // A repeated field takes one value per slot; anything else joins into its single cell.
    const perSlot =
      spec.slots > 1 ? values.map((value) => [value]) : [values.length === 0 ? [] : values];

    for (let slot = 0; slot < spec.slots; slot += 1) {
      const slotValues = perSlot[slot] ?? [];
      const reference = `${columnLetter(column)}${rowNumber}`;
      column += 1;
      if (slotValues.length === 0) continue;

      const first = slotValues[0];
      if (spec.kind === 'number' && slotValues.length === 1 && first !== undefined) {
        cells.push(`<c r="${reference}"><v>${escapeXml(first)}</v></c>`);
        continue;
      }
      const text = escapeXml(slotValues.join('、'));
      cells.push(
        `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`,
      );
    }
  }

  if (column !== COLUMN_COUNT) {
    throw new WorkbookError(`Wrote ${column} columns, expected ${COLUMN_COUNT}`);
  }
  return cells.join('');
}

function replaceSheetData(sheetXml: string, rows: readonly SheetRow[]): string {
  const sheetData = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(sheetXml);
  if (sheetData?.[1] === undefined) {
    throw new WorkbookError('Template sheet has no <sheetData> element');
  }
  const headerRow = /<row[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/.exec(sheetData[1]);
  if (headerRow === null) {
    throw new WorkbookError('Template sheet has no header row');
  }

  const body = rows
    .map((row, index) => {
      const rowNumber = HEADER_ROW + 1 + index;
      return `<row r="${rowNumber}" spans="1:${COLUMN_COUNT}">${cellsFor(row, rowNumber)}</row>`;
    })
    .join('');

  const lastRow = HEADER_ROW + rows.length;
  return sheetXml
    .replace(
      /<dimension ref="[^"]*"\/>/,
      `<dimension ref="A1:${columnLetter(COLUMN_COUNT - 1)}${lastRow}"/>`,
    )
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${headerRow[0]}${body}</sheetData>`);
}

/** Returns a new .xlsx: the template with `rows` written under its header row. */
export function fillTemplate(template: Buffer, rows: readonly SheetRow[]): Buffer {
  const entries = readZip(template);
  if (!entries.some((entry) => entry.name === DATA_SHEET_PATH)) {
    throw new WorkbookError(`Template does not contain ${DATA_SHEET_PATH}`);
  }
  const filled: readonly ZipEntry[] = entries.map((entry) =>
    entry.name === DATA_SHEET_PATH
      ? {
          name: entry.name,
          data: Buffer.from(replaceSheetData(entry.data.toString('utf8'), rows), 'utf8'),
        }
      : entry,
  );
  return writeZip(filled);
}
