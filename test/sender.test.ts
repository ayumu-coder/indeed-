import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildOwnerEmailMap, resolveSender, type SenderPolicy } from '../src/domain/sender.ts';

const OWNERS = buildOwnerEmailMap([
  '新田:nitta@quad-4.co.jp',
  '針山:hariyama@quad-4.co.jp',
  '大津:otsu@quad-4.co.jp',
]);

const STRICT: SenderPolicy = { ownerEmails: OWNERS, defaultAddress: null, fallbackToDefault: false };

test('each 担当者 resolves to their own address', () => {
  assert.deepEqual(resolveSender('新田', STRICT), {
    kind: 'resolved',
    address: 'nitta@quad-4.co.jp',
    displayName: '新田',
  });
  assert.deepEqual(resolveSender('針山', STRICT), {
    kind: 'resolved',
    address: 'hariyama@quad-4.co.jp',
    displayName: '針山',
  });
});

test('surrounding and full-width whitespace does not break the lookup', () => {
  for (const owner of [' 新田 ', '新　田', '新 田']) {
    const resolved = resolveSender(owner, STRICT);
    assert.equal(resolved.kind, 'resolved', `expected a match for "${owner}"`);
  }
});

test('an unmapped 担当者 is reported rather than sent from somebody else', () => {
  assert.deepEqual(resolveSender('未登録', STRICT), { kind: 'unmapped', owner: '未登録' });
});

test('an unmapped 担当者 uses the default only when the fallback is enabled', () => {
  const policy: SenderPolicy = { ...STRICT, defaultAddress: 'info@quad-4.co.jp' };
  assert.equal(resolveSender('未登録', policy).kind, 'unmapped');
  assert.deepEqual(resolveSender('未登録', { ...policy, fallbackToDefault: true }), {
    kind: 'resolved',
    address: 'info@quad-4.co.jp',
    displayName: '未登録',
  });
});

test('a blank 担当者 always uses the default when one exists', () => {
  const policy: SenderPolicy = { ...STRICT, defaultAddress: 'info@quad-4.co.jp' };
  assert.deepEqual(resolveSender('', policy), {
    kind: 'resolved',
    address: 'info@quad-4.co.jp',
    displayName: '',
  });
  assert.equal(resolveSender('', STRICT).kind, 'unmapped');
});

test('buildOwnerEmailMap rejects malformed entries', () => {
  assert.throws(() => buildOwnerEmailMap(['新田']), /Invalid OWNER_EMAIL_MAP/);
  assert.throws(() => buildOwnerEmailMap([':a@b.com']), /Invalid OWNER_EMAIL_MAP/);
  assert.throws(() => buildOwnerEmailMap(['新田:']), /Invalid OWNER_EMAIL_MAP/);
});
