/**
 * 環境変数の読み取り。
 * 空文字は「未設定」として扱う。`Number('')` が 0 になるため、
 * 素直に `Number(process.env[key] ?? fallback)` と書くと空文字が 0 に化ける。
 */
export function stringFromEnv(key: string): string | null {
  const raw = process.env[key];
  return raw === undefined || raw.trim().length === 0 ? null : raw;
}

export function numberFromEnv(key: string, fallback: number): number {
  const raw = stringFromEnv(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
