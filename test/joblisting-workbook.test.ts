import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, readZip, writeZip } from '../src/joblisting/zip.ts';
import { columnLetter, escapeXml, fillTemplate, type SheetRow } from '../src/joblisting/workbook.ts';
import { normalisePosting } from '../src/joblisting/posting.ts';
import { DEFAULT_TEMPLATE_PATH } from '../src/joblisting/config.ts';

const TEMPLATE = readFileSync(DEFAULT_TEMPLATE_PATH);

function sheetXml(workbook: Buffer): string {
  const entry = readZip(workbook).find((candidate) => candidate.name === 'xl/worksheets/sheet1.xml');
  assert.ok(entry, 'workbook is missing the 求人入力シート');
  return entry.data.toString('utf8');
}

test('crc32 matches the known PKZIP check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf4_3926);
});

test('zip round-trips both compressible and incompressible entries', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('x'.repeat(5_000)) },
    { name: 'dir/b.bin', data: Buffer.from([0, 1, 2, 3]) },
    { name: 'c.txt', data: Buffer.from('日本語のテキスト', 'utf8') },
  ];
  assert.deepEqual(readZip(writeZip(entries)), entries);
});

test('every part of the template survives a fill', () => {
  const workbook = fillTemplate(TEMPLATE, []);
  const original = readZip(TEMPLATE).map((entry) => entry.name);
  assert.deepEqual(
    readZip(workbook).map((entry) => entry.name),
    original,
    'every part of the template survives, in its original order',
  );
});

test('columnLetter walks past Z the way a spreadsheet does', () => {
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
  assert.equal(columnLetter(69), 'BR');
});

test('escapeXml escapes markup and strips characters XML 1.0 forbids', () => {
  assert.equal(escapeXml('a & b <c> "d"'), 'a &amp; b &lt;c&gt; &quot;d&quot;');
  assert.equal(escapeXml('keep\nthis\ttoo'), 'keep\nthis\ttoo');
  assert.equal(escapeXml(`drop${String.fromCharCode(0x0b)}this`), 'dropthis');
});

test('filling with no rows leaves the template with only its header row', () => {
  const xml = sheetXml(fillTemplate(TEMPLATE, []));
  assert.match(xml, /<dimension ref="A1:BR1"\/>/);
  assert.equal(xml.match(/<row /g)?.length, 1);
  assert.match(xml, /ステータス|<c r="A1"/);
});

test('a filled row writes text inline, numbers bare, and blanks not at all', () => {
  const posting = normalisePosting({
    status: '募集中',
    companyName: '◯◯◯株式会社',
    salaryMin: '25万円',
    descriptionJob: '設計 & 開発\n<全般>',
  });
  const xml = sheetXml(fillTemplate(TEMPLATE, [posting.values]));

  assert.match(xml, /<dimension ref="A1:BR2"\/>/);
  assert.match(xml, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">募集中<\/t><\/is><\/c>/);
  assert.match(xml, /<c r="M2"><v>250000<\/v><\/c>/);
  assert.match(xml, /設計 &amp; 開発\n&lt;全般&gt;/);
  assert.doesNotMatch(xml, /<c r="E2"/, '求人キャッチコピー was blank, so no cell is emitted');
});

test('repeated fields spread one value per column instead of sharing a cell', () => {
  const posting = normalisePosting({ tags: '在宅OK、フルリモート' });
  const xml = sheetXml(fillTemplate(TEMPLATE, [posting.values]));
  assert.match(xml, /<c r="BE2" t="inlineStr"><is><t xml:space="preserve">在宅OK<\/t>/);
  assert.match(xml, /<c r="BF2" t="inlineStr"><is><t xml:space="preserve">フルリモート<\/t>/);
  assert.doesNotMatch(xml, /<c r="BG2"/, 'the unused third タグ column stays empty');
});

test('a multi-value field with a single column joins its values into that cell', () => {
  const posting = normalisePosting({ socialInsurance: '健康保険、厚生年金' });
  const xml = sheetXml(fillTemplate(TEMPLATE, [posting.values]));
  assert.match(xml, /<c r="Z2" t="inlineStr"><is><t xml:space="preserve">健康保険、厚生年金<\/t>/);
});

test('several postings become several rows', () => {
  const rows: SheetRow[] = [
    normalisePosting({ companyName: '一社目' }).values,
    normalisePosting({ companyName: '二社目' }).values,
  ];
  const xml = sheetXml(fillTemplate(TEMPLATE, rows));
  assert.match(xml, /<dimension ref="A1:BR3"\/>/);
  assert.match(xml, /<c r="B2" t="inlineStr"><is><t xml:space="preserve">一社目<\/t>/);
  assert.match(xml, /<c r="B3" t="inlineStr"><is><t xml:space="preserve">二社目<\/t>/);
});
