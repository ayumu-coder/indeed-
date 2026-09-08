import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageError, groupInputs, parseArgs } from '../src/joblisting/cli.ts';
import { loadJobListingConfig, DEFAULT_MODEL } from '../src/joblisting/config.ts';
import { ConfigError } from '../src/env.ts';

test('parseArgs reads options and source paths in any order', () => {
  const options = parseArgs(['a.pdf', '--out', 'out.xlsx', 'b.png', '--split']);
  assert.deepEqual(options, {
    outPath: 'out.xlsx',
    templatePath: null,
    split: true,
    inputPaths: ['a.pdf', 'b.png'],
  });
});

test('parseArgs rejects a missing --out, missing sources and unknown flags', () => {
  assert.throws(() => parseArgs(['a.pdf']), UsageError);
  assert.throws(() => parseArgs(['--out', 'out.xlsx']), UsageError);
  assert.throws(() => parseArgs(['--out', 'out.xlsx', '--nope', 'a.pdf']), UsageError);
});

test('parseArgs will not swallow the next flag as a path value', () => {
  assert.throws(() => parseArgs(['--out', '--split', 'a.pdf']), UsageError);
});

test('every source becomes its own row under --split, one row otherwise', () => {
  const paths = ['dir/a.pdf', 'dir/b.pdf'];
  assert.deepEqual(
    groupInputs({ outPath: 'o.xlsx', templatePath: null, split: true, inputPaths: paths }),
    [
      { label: 'a.pdf', paths: ['dir/a.pdf'] },
      { label: 'b.pdf', paths: ['dir/b.pdf'] },
    ],
  );
  assert.deepEqual(
    groupInputs({ outPath: 'o.xlsx', templatePath: null, split: false, inputPaths: paths }),
    [{ label: 'posting-1', paths }],
  );
});

test('the config needs an API key and defaults the rest', () => {
  assert.throws(() => loadJobListingConfig({}), ConfigError);
  const config = loadJobListingConfig({ ANTHROPIC_API_KEY: 'sk-test' });
  assert.equal(config.model, DEFAULT_MODEL);
  assert.equal(config.maxTokens, 16_000);
  assert.throws(
    () => loadJobListingConfig({ ANTHROPIC_API_KEY: 'sk-test', EXTRACTION_MAX_TOKENS: '10' }),
    ConfigError,
  );
});
