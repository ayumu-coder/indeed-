/**
 * Columns are resolved by header text rather than by fixed index, so inserting or
 * reordering columns in the spreadsheet cannot silently mis-address a candidate.
 */
export const COLUMN_KEYS = [
  'company',
  'appliedAt',
  'jobTitle',
  'candidateName',
  'owner',
  'email',
  'phone',
  'interviewScheduled',
  'interviewAt',
  'remindFlag',
  'interviewResult',
] as const;

export type ColumnKey = (typeof COLUMN_KEYS)[number];

/** Header labels accepted for each column, in the spreadsheet's own wording. */
const HEADER_ALIASES: Readonly<Record<ColumnKey, readonly string[]>> = {
  company: ['求人掲載企業', '企業名'],
  appliedAt: ['応募日'],
  jobTitle: ['応募職種', '職種'],
  candidateName: ['求職者名', '氏名', '名前'],
  owner: ['担当者'],
  email: ['メールアドレス', 'メール', 'Email'],
  phone: ['電話番号'],
  interviewScheduled: ['面接設定可否'],
  interviewAt: ['初回面接予定日', '面接予定日', '面接日'],
  remindFlag: ['リマインド可否', 'リマインド'],
  interviewResult: ['面接実施可否'],
};

/** Columns without which a row cannot be turned into a reminder at all. */
const REQUIRED: readonly ColumnKey[] = ['candidateName', 'email', 'interviewAt'];

export type ColumnMap = Readonly<Partial<Record<ColumnKey, number>>>;

function normalise(header: string): string {
  return header.replace(/[\s　]+/g, '').toLowerCase();
}

/**
 * Builds a column map from a candidate header row, or returns null when the row is not
 * a header (missing one of the required columns).
 */
export function buildColumnMap(headerRow: readonly string[]): ColumnMap | null {
  const normalised = headerRow.map((cell) => normalise(cell ?? ''));
  const map: Partial<Record<ColumnKey, number>> = {};

  for (const key of COLUMN_KEYS) {
    const aliases = HEADER_ALIASES[key].map(normalise);
    const index = normalised.findIndex((cell) => cell !== '' && aliases.includes(cell));
    if (index >= 0) map[key] = index;
  }

  return REQUIRED.every((key) => map[key] !== undefined) ? map : null;
}

/** Locates the header row within the first `searchDepth` rows of a sheet. */
export function locateHeader(
  rows: readonly (readonly string[])[],
  searchDepth = 10,
): { readonly rowIndex: number; readonly columns: ColumnMap } | null {
  const depth = Math.min(searchDepth, rows.length);
  for (let rowIndex = 0; rowIndex < depth; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row === undefined) continue;
    const columns = buildColumnMap(row);
    if (columns !== null) return { rowIndex, columns };
  }
  return null;
}
