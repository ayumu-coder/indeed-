/** Environment-variable parsing shared by every entry point. */

export class ConfigError extends Error {}

export type Env = Readonly<Record<string, string | undefined>>;

export function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === '') throw new ConfigError(`Missing required env var: ${key}`);
  return value;
}

export function optional(env: Env, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value === undefined || value === '' ? fallback : value;
}

export function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`Invalid boolean for ${key}: ${raw}`);
}

export function integer(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new ConfigError(`Invalid integer for ${key}: ${raw}`);
  return parsed;
}

export function list(env: Env, key: string, fallback: readonly string[]): readonly string[] {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (raw.trim() === '') return [];
  return raw.split(',').map((item) => item.trim()).filter((item) => item !== '');
}
