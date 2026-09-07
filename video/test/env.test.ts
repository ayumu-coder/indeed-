import assert from 'node:assert/strict';
import { test } from 'node:test';
import { numberFromEnv, stringFromEnv } from '../src/env.ts';

const KEY = 'VIDEO_ENV_TEST_KEY';

function withEnv(value: string | undefined, run: () => void): void {
  const previous = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[KEY];
    else process.env[KEY] = previous;
  }
}

test('未設定なら既定値を返す', () => {
  withEnv(undefined, () => {
    assert.equal(numberFromEnv(KEY, 1.8), 1.8);
    assert.equal(stringFromEnv(KEY), null);
  });
});

test('空文字は 0 ではなく既定値になる', () => {
  // Number('') === 0 のため、素朴に書くと話速 0 で open_jtalk が落ちる。
  withEnv('', () => assert.equal(numberFromEnv(KEY, 1.8), 1.8));
  withEnv('   ', () => assert.equal(numberFromEnv(KEY, 1.8), 1.8));
});

test('数値として解釈できない値は既定値になる', () => {
  withEnv('fast', () => assert.equal(numberFromEnv(KEY, 1.8), 1.8));
  withEnv('Infinity', () => assert.equal(numberFromEnv(KEY, 1.8), 1.8));
});

test('有効な値はそのまま使う', () => {
  withEnv('2.1', () => assert.equal(numberFromEnv(KEY, 1.8), 2.1));
  withEnv('-22', () => assert.equal(numberFromEnv(KEY, -18), -22));
  withEnv('0', () => assert.equal(numberFromEnv(KEY, 1.8), 0));
  withEnv('http://x', () => assert.equal(stringFromEnv(KEY), 'http://x'));
});
