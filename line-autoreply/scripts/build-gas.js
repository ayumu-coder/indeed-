// lib/*.js (ESM) と gas/src/entry.js を結合して、手貼りできる 1 ファイル gas/Code.gs を生成する。
// 変換内容: `import` 行を落とし、行頭の `export ` を外すだけ。それ以外は原文のまま。

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LIB_DIR = join(ROOT, 'lib');
export const ENTRY_PATH = join(ROOT, 'gas', 'src', 'entry.js');
export const OUTPUT_PATH = join(ROOT, 'gas', 'Code.gs');

const BANNER = [
  '// このファイルは自動生成です。直接編集せず lib/*.js と gas/src/entry.js を編集し、',
  '// line-autoreply/ で `npm run build` を実行してください。',
  '// Apps Script エディタにはこのファイルの全文をそのまま貼り付けます。',
  '',
].join('\n');

/**
 * ESM のモジュール 1 本を GAS 用のグローバルスクリプト片に変換する。
 * @param {string} code
 * @returns {string}
 */
export function stripModuleSyntax(code) {
  return code
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .map((line) => line.replace(/^export\s+(?=(const|let|var|function|class)\b)/, ''))
    .join('\n');
}

/**
 * @param {{ libSources: { name: string, code: string }[], entrySource: string }} input
 * @returns {string}
 */
export function buildCodeGs(input) {
  const parts = [BANNER];
  for (const { name, code } of input.libSources) {
    parts.push(`// ===== lib/${name} =====`, stripModuleSyntax(code).trimEnd(), '');
  }
  parts.push(input.entrySource.trimEnd(), '');
  return parts.join('\n');
}

/** ディスク上の lib/ と entry.js から Code.gs の内容を作る。 */
export function buildFromDisk() {
  const libSources = readdirSync(LIB_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((name) => ({ name, code: readFileSync(join(LIB_DIR, name), 'utf8') }));
  const entrySource = readFileSync(ENTRY_PATH, 'utf8');
  return buildCodeGs({ libSources, entrySource });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT_PATH, buildFromDisk());
  console.log(`wrote ${OUTPUT_PATH}`);
}
