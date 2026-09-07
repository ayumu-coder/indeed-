import { createHash } from 'node:crypto';

/**
 * LINE requires `X-Line-Retry-Key` to be a UUID and remembers it for 24 hours,
 * so deriving it from the Gmail message id makes a duplicate push within that
 * window a no-op on LINE's side — a second line of defence behind the label.
 */
export function deterministicRetryKey(seed: string): string {
  const hex = createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32);
  const bytes = hex.split('');
  // Force the version (4) and variant (10xx) nibbles so the value is a well-formed UUID.
  bytes[12] = '4';
  bytes[16] = (['8', '9', 'a', 'b'] as const)[Number.parseInt(hex[16] ?? '0', 16) % 4] ?? '8';
  const uuid = bytes.join('');
  return [
    uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32),
  ].join('-');
}
