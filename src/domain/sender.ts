/**
 * Resolves which address a reminder is sent from, based on the 担当者 column.
 *
 * Kept pure and separate from the Gmail adapter: choosing a From address is a
 * business rule, not a transport concern, and it must be unit-testable without
 * touching Google.
 */
export interface SenderPolicy {
  /** 担当者名 → 送信元アドレス. Keys are matched with whitespace removed. */
  readonly ownerEmails: ReadonlyMap<string, string>;
  /** Used when the 担当者 cell is blank, or is unmapped and fallback is allowed. */
  readonly defaultAddress: string | null;
  /** When false, an unmapped 担当者 blocks the send instead of silently using the default. */
  readonly fallbackToDefault: boolean;
}

export type SenderResolution =
  | { readonly kind: 'resolved'; readonly address: string; readonly displayName: string }
  | { readonly kind: 'unmapped'; readonly owner: string };

export function normaliseOwner(owner: string): string {
  return owner.replace(/[\s　]+/g, '');
}

export function buildOwnerEmailMap(entries: readonly string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    if (separator <= 0) throw new Error(`Invalid OWNER_EMAIL_MAP entry (expected 担当者名:address): ${entry}`);
    const owner = normaliseOwner(entry.slice(0, separator));
    const address = entry.slice(separator + 1).trim();
    if (owner === '' || address === '') throw new Error(`Invalid OWNER_EMAIL_MAP entry: ${entry}`);
    map.set(owner, address);
  }
  return map;
}

export function resolveSender(owner: string, policy: SenderPolicy): SenderResolution {
  const key = normaliseOwner(owner);

  const mapped = key === '' ? undefined : policy.ownerEmails.get(key);
  if (mapped !== undefined) return { kind: 'resolved', address: mapped, displayName: owner.trim() };

  // A blank 担当者 was never going to resolve to a person, so the default applies
  // regardless of the fallback setting; an unmapped *named* owner is a config gap.
  const allowDefault = key === '' || policy.fallbackToDefault;
  if (allowDefault && policy.defaultAddress !== null) {
    return { kind: 'resolved', address: policy.defaultAddress, displayName: owner.trim() };
  }
  return { kind: 'unmapped', owner: owner.trim() };
}
