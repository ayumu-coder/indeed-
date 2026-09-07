import { type JstDay, makeJstDay, toJstDay } from './jst.ts';

/** A parsed interview slot: the JST day, plus a time of day when the cell carried one. */
export interface SheetDate {
  readonly day: JstDay;
  /** "14:30" when the cell had a non-midnight time, otherwise null. */
  readonly timeOfDay: string | null;
}

/** Days between the Sheets serial epoch (1899-12-30) and the Unix epoch. */
const SHEETS_EPOCH_OFFSET_DAYS = 25_569;
const DAY_MS = 86_400_000;

const FULL_DATE = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?(?:[\sT]+(\d{1,2}):(\d{2}))?/;
const SHORT_DATE = /^(\d{1,2})[/\-.月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?$/;
const BARE_NUMBER = /^\d+(?:\.\d+)?$/;

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function formatTime(hour: number, minute: number): string | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (hour === 0 && minute === 0) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function optionalTime(hour: string | undefined, minute: string | undefined): string | null {
  if (hour === undefined || minute === undefined) return null;
  return formatTime(Number(hour), Number(minute));
}

/**
 * Sheets serials count days in the spreadsheet's own timezone, so the integer part
 * maps to a calendar day without any timezone conversion.
 */
function fromSerial(serial: number): SheetDate | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const days = Math.floor(serial);
  const utc = new Date((days - SHEETS_EPOCH_OFFSET_DAYS) * DAY_MS);
  if (Number.isNaN(utc.getTime())) return null;
  const fractionMinutes = Math.round((serial - days) * 1440);
  return {
    day: makeJstDay(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate()),
    timeOfDay: formatTime(Math.floor(fractionMinutes / 60), fractionMinutes % 60),
  };
}

/**
 * Year-less cells such as "5/13" resolve to whichever of the previous, current or next
 * year sits closest to `now`, so a late-December run still reads "1/5" as next year.
 */
function inferYear(month: number, day: number, now: Date): number | null {
  const [thisYear, thisMonth, thisDay] = toJstDay(now).split('-').map(Number) as [number, number, number];
  const todayMs = Date.UTC(thisYear, thisMonth - 1, thisDay);
  let best: { readonly year: number; readonly distance: number } | null = null;
  for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
    if (!isValidYmd(year, month, day)) continue;
    const distance = Math.abs(Date.UTC(year, month - 1, day) - todayMs);
    if (best === null || distance < best.distance) best = { year, distance };
  }
  return best === null ? null : best.year;
}

/**
 * Parses one interview-date cell. Accepts Sheets serial numbers, "2026/07/28 0:00:00",
 * ISO dates and year-less "5/13" text. Returns null for anything unrecognised — callers
 * must treat that as "do not send", never as "send today".
 */
export function parseSheetDate(value: unknown, now: Date): SheetDate | null {
  if (typeof value === 'number') return fromSerial(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : { day: toJstDay(value), timeOfDay: null };
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (text === '') return null;

  const full = FULL_DATE.exec(text);
  if (full !== null) {
    const [, y, m, d, hh, mm] = full;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (!isValidYmd(year, month, day)) return null;
    return { day: makeJstDay(year, month, day), timeOfDay: optionalTime(hh, mm) };
  }

  const short = SHORT_DATE.exec(text);
  if (short !== null) {
    const [, m, d, hh, mm] = short;
    const month = Number(m);
    const day = Number(d);
    const year = inferYear(month, day, now);
    if (year === null) return null;
    return { day: makeJstDay(year, month, day), timeOfDay: optionalTime(hh, mm) };
  }

  if (BARE_NUMBER.test(text)) return fromSerial(Number(text));
  return null;
}
