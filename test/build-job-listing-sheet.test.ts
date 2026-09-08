import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJobListingSheet } from '../src/usecase/build-job-listing-sheet.ts';
import { readZip } from '../src/joblisting/zip.ts';
import { DEFAULT_TEMPLATE_PATH } from '../src/joblisting/config.ts';
import type { JobExtractor } from '../src/joblisting/extractor.ts';
import type { JobPostingDraft } from '../src/joblisting/posting.ts';
import type { Logger } from '../src/ports.ts';

const TEMPLATE = readFileSync(DEFAULT_TEMPLATE_PATH);

interface LogEntry {
  readonly level: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

function recordingLogger(entries: LogEntry[]): Logger {
  const record =
    (level: string) =>
    (message: string, fields?: Readonly<Record<string, unknown>>): void => {
      entries.push({ level, message, fields: fields ?? {} });
    };
  return { info: record('info'), warn: record('warn'), error: record('error') };
}

function stubExtractor(drafts: readonly JobPostingDraft[]): JobExtractor {
  let call = 0;
  return {
    extract: async () => {
      const draft = drafts[call];
      call += 1;
      assert.ok(draft, 'extractor called more times than there are groups');
      return draft;
    },
  };
}

async function writeSources(names: readonly string[]): Promise<readonly string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'joblisting-'));
  return Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      await writeFile(path, `${name} の中身`, 'utf8');
      return path;
    }),
  );
}

test('each group becomes one row and the workbook stays a valid template', async () => {
  const [first, second] = await writeSources(['a.txt', 'b.txt']);
  assert.ok(first !== undefined && second !== undefined);
  const entries: LogEntry[] = [];

  const result = await buildJobListingSheet(
    {
      template: TEMPLATE,
      groups: [
        { label: 'a', paths: [first] },
        { label: 'b', paths: [second] },
      ],
    },
    {
      extractor: stubExtractor([{ companyName: '一社目' }, { companyName: '二社目' }]),
      logger: recordingLogger(entries),
    },
  );

  assert.equal(result.rowCount, 2);
  const sheet = readZip(result.workbook).find((e) => e.name === 'xl/worksheets/sheet1.xml');
  assert.ok(sheet);
  assert.match(sheet.data.toString('utf8'), /<dimension ref="A1:BR3"\/>/);
});

test('dropped values and blank required fields are logged, not swallowed', async () => {
  const [path] = await writeSources(['memo.txt']);
  assert.ok(path !== undefined);
  const entries: LogEntry[] = [];

  await buildJobListingSheet(
    { template: TEMPLATE, groups: [{ label: 'memo', paths: [path] }] },
    {
      extractor: stubExtractor([{ employmentType: '正社員、フリーランス' }]),
      logger: recordingLogger(entries),
    },
  );

  const dropped = entries.find((entry) => entry.message === 'value dropped');
  assert.deepEqual(dropped?.fields, {
    group: 'memo',
    field: '雇用形態',
    value: 'フリーランス',
    reason: 'not-in-allowed-values',
  });
  const missing = entries.find((entry) => entry.message === 'required fields left blank');
  assert.ok(Array.isArray(missing?.fields['fields']));
  assert.ok((missing?.fields['fields'] as readonly string[]).includes('companyName'));
});
