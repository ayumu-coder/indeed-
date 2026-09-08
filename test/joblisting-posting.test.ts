import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePosting, parseAmount } from '../src/joblisting/posting.ts';
import { FIELDS, COLUMN_COUNT, valueCapacity } from '../src/joblisting/schema.ts';

test('the schema matches the Indeed template layout', () => {
  assert.equal(COLUMN_COUNT, 70, 'the sheet spans A..BR');
  assert.equal(FIELDS.length, 66, 'タグ and 応募者に関する情報 each occupy three columns');
  assert.equal(new Set(FIELDS.map((field) => field.key)).size, FIELDS.length);
  for (const field of FIELDS) {
    assert.ok(field.header.trim() !== '', `${field.key} needs a header`);
    assert.ok(field.slots >= 1, `${field.key} needs at least one column`);
  }
});

test('parseAmount reads the amount formats a Japanese job ad actually uses', () => {
  assert.equal(parseAmount('250000'), 250_000);
  assert.equal(parseAmount('1,200'), 1_200);
  assert.equal(parseAmount('２５万'), 250_000);
  assert.equal(parseAmount('30万円'), 300_000);
  assert.equal(parseAmount('￥1200'), 1_200);
});

test('parseAmount refuses anything ambiguous rather than guessing', () => {
  assert.equal(parseAmount('200000〜500000'), null);
  assert.equal(parseAmount('応相談'), null);
  assert.equal(parseAmount(''), null);
});

test('an empty draft yields blanks everywhere and reports every required field', () => {
  const posting = normalisePosting({});
  assert.equal(posting.issues.length, 0);
  for (const field of FIELDS) {
    assert.deepEqual(posting.values.get(field.key), []);
  }
  assert.deepEqual(
    posting.missingRequired,
    FIELDS.filter((field) => field.required).map((field) => field.key),
  );
});

test('values outside a closed set are dropped, not written', () => {
  const posting = normalisePosting({ employmentType: '正社員、フリーランス' });
  assert.deepEqual(posting.values.get('employmentType'), ['正社員']);
  assert.deepEqual(posting.issues, [
    { field: '雇用形態', value: 'フリーランス', reason: 'not-in-allowed-values' },
  ]);
});

test('numeric fields are normalised and unparsable ones left blank', () => {
  const posting = normalisePosting({ salaryMin: '25万円', salaryMax: '要相談' });
  assert.deepEqual(posting.values.get('salaryMin'), ['250000']);
  assert.deepEqual(posting.values.get('salaryMax'), []);
  assert.deepEqual(posting.issues, [
    { field: '給与（最高額）', value: '要相談', reason: 'not-a-number' },
  ]);
});

test('postal codes, phones and mail addresses are validated before they reach a cell', () => {
  const posting = normalisePosting({
    postalCode: '１０８-００２３',
    inquiryPhone: '03 (1234) 5678',
    applicationEmail: 'ok@example.com,broken-address',
  });
  assert.deepEqual(posting.values.get('postalCode'), ['1080023']);
  assert.deepEqual(posting.values.get('inquiryPhone'), ['0312345678']);
  assert.deepEqual(posting.values.get('applicationEmail'), ['ok@example.com']);
  assert.deepEqual(posting.issues, [
    { field: '応募用メールアドレス', value: 'broken-address', reason: 'invalid-email' },
  ]);
});

test('the catch copy loses its newlines and an over-long one is dropped', () => {
  const posting = normalisePosting({ catchCopy: '一行目\n二行目' });
  assert.deepEqual(posting.values.get('catchCopy'), ['一行目 二行目']);

  const overLong = normalisePosting({ catchCopy: 'あ'.repeat(257) });
  assert.deepEqual(overLong.values.get('catchCopy'), []);
  assert.equal(overLong.issues[0]?.reason, 'too-long');
});

test('surplus values beyond a field capacity are reported, not silently truncated', () => {
  assert.equal(valueCapacity(FIELDS.find((field) => field.key === 'tags')!), 3);
  const posting = normalisePosting({
    tags: '在宅OK、フルリモート、残業なし、交通費支給',
  });
  assert.deepEqual(posting.values.get('tags'), ['在宅OK', 'フルリモート', '残業なし']);
  assert.deepEqual(posting.issues, [
    { field: 'タグ', value: '交通費支給', reason: 'over-value-limit' },
  ]);
});

test('a key that is not a column is reported instead of being written somewhere', () => {
  const posting = normalisePosting({ notAColumn: 'x' } as never);
  assert.deepEqual(posting.issues, [{ field: 'notAColumn', value: 'x', reason: 'unknown-field' }]);
});
