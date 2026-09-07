import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANNED_PHRASES, ScriptValidationError, narrationCharCount, parseScriptSet, plainLength } from '../src/validate.ts';

const base = {
  id: 'ok-1',
  title: 'タイトル',
  hookType: '損失回避',
  telopFirstFrame: 'テロップ',
  script: {
    hook: 'あ'.repeat(15),
    problem: 'い'.repeat(45),
    solution: 'う'.repeat(85),
    cta: 'え'.repeat(25),
  },
  visual: { kind: 'bullets', caption: 'c', items: ['a', 'b'] },
  disclaimer: '※注記',
  ctaLabel: 'CTA',
  hashtags: ['tag'],
};

test('正常な台本は検証を通る', () => {
  const scripts = parseScriptSet([base]);
  assert.equal(scripts.length, 1);
  assert.equal(narrationCharCount(scripts[0]!), 170);
});

test('禁止表現を含む台本は落ちる', () => {
  for (const phrase of BANNED_PHRASES.slice(0, 3)) {
    const bad = { ...base, script: { ...base.script, solution: `${phrase}${'う'.repeat(80)}` } };
    assert.throws(() => parseScriptSet([bad]), ScriptValidationError);
  }
});

test('文字数が範囲外なら落ちる', () => {
  const short = { ...base, script: { ...base.script, solution: 'う'.repeat(10) } };
  assert.throws(() => parseScriptSet([short]), /文字/);
});

test('id の重複を検出する', () => {
  assert.throws(() => parseScriptSet([base, { ...base }]), /重複/);
});

test('未知の visual.kind は落ちる', () => {
  assert.throws(() => parseScriptSet([{ ...base, visual: { kind: 'pie', caption: 'c' } }]), /kind/);
});

test('強調記号は文字数に数えない', () => {
  assert.equal(plainLength('**5%**を積立'), 5);
});
