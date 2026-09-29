import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { OUTPUT_PATH, buildCodeGs, buildFromDisk, stripModuleSyntax } from '../scripts/build-gas.js';

test('stripModuleSyntax: import 行を落とし export を外す', () => {
  const src = [
    "import { a } from './a.js';",
    'export function f() {}',
    'export const X = 1;',
    'const exportName = 2; // 行頭でない export は触らない',
    'class C {}',
  ].join('\n');
  assert.equal(
    stripModuleSyntax(src),
    ['function f() {}', 'const X = 1;', 'const exportName = 2; // 行頭でない export は触らない', 'class C {}'].join('\n'),
  );
});

test('buildCodeGs: lib → entry の順に結合し、区切りコメントを付ける', () => {
  const out = buildCodeGs({
    libSources: [{ name: 'z.js', code: 'export const z = 1;\n' }],
    entrySource: 'function doPost() {}\n',
  });
  assert.ok(out.indexOf('// ===== lib/z.js =====') < out.indexOf('const z = 1;'));
  assert.ok(out.indexOf('const z = 1;') < out.indexOf('function doPost() {}'));
  assert.ok(!/^import\s/m.test(out));
  assert.ok(!/^export\s/m.test(out));
});

test('gas/Code.gs は lib/ と entry.js の最新内容と一致する (npm run build 済み)', () => {
  const committed = readFileSync(OUTPUT_PATH, 'utf8');
  assert.equal(committed, buildFromDisk(), 'gas/Code.gs が古い。line-autoreply/ で npm run build を実行してください');
});

test('gas/Code.gs は単一スクリプトとして構文解析でき、期待する関数を定義する', () => {
  const code = readFileSync(OUTPUT_PATH, 'utf8');
  // GAS はスクリプト (非モジュール) として評価する。Script は構文チェックのみで実行しない。
  assert.doesNotThrow(() => new vm.Script(code, { filename: 'Code.gs' }));
  for (const fn of ['doPost', 'doGet', 'setup', 'processQueue', 'installTrigger', 'generateWebhookToken', 'checkConfig']) {
    assert.match(code, new RegExp(`^function ${fn}\\(`, 'm'), fn);
  }
});

test('gas/Code.gs の純粋部分は GAS のグローバルを使わずに動く', () => {
  const code = readFileSync(OUTPUT_PATH, 'utf8');
  // 実行時に必要な GAS グローバルは定義時には参照されないはず。関数定義だけを評価する。
  const context = vm.createContext({});
  vm.runInContext(code, context, { filename: 'Code.gs' });
  const row = vm.runInContext(
    'eventToRow({ type: "message", source: { type: "group", groupId: "C1", userId: "U1" }, message: { type: "text", text: "hi" } }, new Date(0))',
    context,
  );
  assert.equal(row[1], 'message');
  assert.equal(row[3], 'C1');
  assert.equal(row[6], 'hi');
  assert.equal(row[8], '未処理');
  const auth = vm.runInContext(
    'authenticateWebhookRequest({ body: "{}", signatureHeader: null, queryToken: "t", webhookToken: "t", destination: "", botUserId: "" })',
    context,
  );
  assert.equal(auth.ok, true);
});
