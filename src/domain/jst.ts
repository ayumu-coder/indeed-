/** Japan Standard Time helpers. JST has no DST, so a fixed +09:00 offset is exact. */

export const JST_OFFSET_MINUTES = 9 * 60;

/** A calendar day in JST, e.g. "2026-09-08". Opaque-ish alias for readability. */
export type JstDay = string & { readonly __brand: 'JstDay' };

const DAY_MS = 86_400_000;

export function isJstDay(value: string): value is JstDay {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function makeJstDay(year: number, month: number, day: number): JstDay {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}` as JstDay;
}

/** The JST calendar day that `instant` falls on. */
export function toJstDay(instant: Date): JstDay {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MINUTES * 60_000);
  return makeJstDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** `day` shifted by `days` calendar days, still in JST. */
export function addDays(day: JstDay, days: number): JstDay {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return makeJstDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** "2026年9月8日(月)" — the form used in the candidate-facing mail body. */
export function formatJapanese(day: JstDay): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAY_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  return `${y}年${m}月${d}日(${weekday})`;
}

/** Absolute difference in calendar days between two JST days. */
export function daysBetween(a: JstDay, b: JstDay): number {
  const toUtc = (day: JstDay): number => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** "14:05" — wall-clock time of `instant` in JST. */
export function formatJstTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MINUTES * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
