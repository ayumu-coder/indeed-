import { FIELDS, FIELD_BY_KEY, valueCapacity, type FieldKey, type FieldSpec } from './schema.ts';

/** Whatever an extractor managed to read. Every field may be missing — blanks are legal. */
export type JobPostingDraft = Readonly<Partial<Record<FieldKey, string>>>;

export type IssueReason =
  | 'not-in-allowed-values'
  | 'not-a-number'
  | 'invalid-postal-code'
  | 'invalid-email'
  | 'invalid-phone'
  | 'too-long'
  | 'over-value-limit'
  | 'unknown-field';

export interface FieldIssue {
  readonly field: string;
  readonly value: string;
  readonly reason: IssueReason;
}

export interface NormalisedPosting {
  /** One entry per field. A field the extractor could not fill maps to an empty array. */
  readonly values: ReadonlyMap<FieldKey, readonly string[]>;
  /** Values that were dropped rather than written, with the rule they broke. */
  readonly issues: readonly FieldIssue[];
  /** Unconditionally required fields left blank. Reported, never invented. */
  readonly missingRequired: readonly FieldKey[];
}

const FULL_WIDTH_DIGITS = /[０-９]/g;
const VALUE_SEPARATOR = /[、,]/;
/** Deliberately permissive: Indeed, not this tool, is the authority on address-like locals. */
const EMAIL = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/;
const PHONE = /^[0-9]+(-[0-9]+)*$/;

function toHalfWidth(value: string): string {
  return value.replace(FULL_WIDTH_DIGITS, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

/**
 * "1,200" → 1200, "25万" → 250000, "月給30万円" → 300000.
 * Returns null when the text carries no unambiguous single number, so the cell stays blank
 * rather than carrying a guess into a live job posting.
 */
export function parseAmount(raw: string): number | null {
  const text = toHalfWidth(raw).replace(/[,\s￥¥円]/g, '');
  const match = /^([0-9]+(?:\.[0-9]+)?)(万)?$/.exec(text);
  if (match === null) return null;
  const [, digits, tenThousand] = match;
  if (digits === undefined) return null;
  const value = Number(digits) * (tenThousand === undefined ? 1 : 10_000);
  return Number.isFinite(value) ? value : null;
}

function splitValues(raw: string, spec: FieldSpec): readonly string[] {
  const parts = spec.multi ? raw.split(VALUE_SEPARATOR) : [raw];
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function normaliseField(
  spec: FieldSpec,
  raw: string,
  issues: FieldIssue[],
): readonly string[] {
  const push = (value: string, reason: IssueReason): void => {
    issues.push({ field: spec.header, value, reason });
  };

  const accepted: string[] = [];
  for (const candidate of splitValues(raw, spec)) {
    if (spec.allowed !== null && !spec.allowed.includes(candidate)) {
      push(candidate, 'not-in-allowed-values');
      continue;
    }
    switch (spec.kind) {
      case 'number': {
        const amount = parseAmount(candidate);
        if (amount === null) {
          push(candidate, 'not-a-number');
          continue;
        }
        accepted.push(String(amount));
        break;
      }
      case 'postalCode': {
        const digits = toHalfWidth(candidate).replace(/-/g, '');
        if (!/^[0-9]{7}$/.test(digits)) {
          push(candidate, 'invalid-postal-code');
          continue;
        }
        accepted.push(digits);
        break;
      }
      case 'email': {
        if (!EMAIL.test(candidate)) {
          push(candidate, 'invalid-email');
          continue;
        }
        accepted.push(candidate);
        break;
      }
      case 'phone': {
        const digits = toHalfWidth(candidate).replace(/[()\s]/g, '');
        if (!PHONE.test(digits)) {
          push(candidate, 'invalid-phone');
          continue;
        }
        accepted.push(digits);
        break;
      }
      case 'text': {
        const collapsed = spec.singleLine ? candidate.replace(/\s*\n\s*/g, ' ') : candidate;
        if (spec.maxChars !== null && [...collapsed].length > spec.maxChars) {
          push(collapsed, 'too-long');
          continue;
        }
        accepted.push(collapsed);
        break;
      }
    }
  }
  const capacity = valueCapacity(spec);
  for (const surplus of accepted.slice(capacity)) push(surplus, 'over-value-limit');
  return accepted.slice(0, capacity);
}

/**
 * Turns a draft into cell-ready values, dropping anything Indeed would reject.
 * A dropped value becomes a blank cell plus an issue — never a silently altered one.
 */
export function normalisePosting(draft: JobPostingDraft): NormalisedPosting {
  const issues: FieldIssue[] = [];
  const values = new Map<FieldKey, readonly string[]>();

  for (const key of Object.keys(draft)) {
    if (!FIELD_BY_KEY.has(key as FieldKey)) {
      issues.push({ field: key, value: draft[key as FieldKey] ?? '', reason: 'unknown-field' });
    }
  }

  for (const spec of FIELDS) {
    const raw = draft[spec.key]?.trim() ?? '';
    values.set(spec.key, raw === '' ? [] : normaliseField(spec, raw, issues));
  }

  const missingRequired = FIELDS.filter(
    (spec) => spec.required && (values.get(spec.key)?.length ?? 0) === 0,
  ).map((spec) => spec.key);

  return { values, issues, missingRequired };
}
