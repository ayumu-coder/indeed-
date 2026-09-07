import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildTimeline, frameCount, sectionAt } from '../src/timeline.ts';
import { toSrt } from '../src/srt.ts';
import { NOMINAL_SECTION_MS, SECTION_NAMES, type ShortScript } from '../src/types.ts';
import { parseScriptSet } from '../src/validate.ts';

const SCRIPT: ShortScript = {
  id: 'x',
  title: 't',
  hookType: '損失回避',
  telopFirstFrame: 'T',
  script: { hook: 'あ。', problem: 'い。', solution: 'う。', cta: 'え。' },
  visual: { kind: 'bullets', items: ['a'], caption: 'c' },
  disclaimer: 'd',
  ctaLabel: 'l',
  hashtags: ['h'],
};

test('セクションは隙間なく連続する', () => {
  const timeline = buildTimeline(SCRIPT, 30);
  let cursor = 0;
  for (const section of timeline.sections) {
    assert.equal(section.startMs, cursor);
    cursor += section.durationMs;
  }
  assert.equal(timeline.totalMs, cursor);
  assert.equal(timeline.sections.length, SECTION_NAMES.length);
});

test('尺はフレーム境界に丸められる', () => {
  const timeline = buildTimeline(SCRIPT, 30, { ...NOMINAL_SECTION_MS, hook: 1516 });
  const frameMs = 1000 / 30;
  for (const section of timeline.sections) {
    assert.equal(Math.round((section.durationMs / frameMs) * 1000) % 1000, 0);
  }
  assert.equal(frameCount(timeline), Math.round((timeline.totalMs / 1000) * 30));
});

test('TTS の実測尺で上書きできる', () => {
  const timeline = buildTimeline(SCRIPT, 30, { ...NOMINAL_SECTION_MS, solution: 12000 });
  assert.equal(sectionAt(timeline, 1500).name, 'problem');
  const solution = timeline.sections.find((section) => section.name === 'solution');
  assert.ok((solution?.durationMs ?? 0) >= 12000 - 34);
});

test('SRT は連番と昇順のタイムコードになる', () => {
  const srt = toSrt(buildTimeline(SCRIPT, 30));
  const indices = srt.split('\n\n').map((block) => Number(block.split('\n')[0]));
  assert.deepEqual(indices, indices.map((_, i) => i + 1).slice(0, indices.length));
  assert.match(srt, /00:00:0\d,\d{3} --> 00:00:0\d,\d{3}/);
});

test('同梱の台本は検証を通り、想定尺に収まる', async () => {
  const raw: unknown = JSON.parse(await readFile(new URL('../data/scripts.json', import.meta.url), 'utf8'));
  const scripts = parseScriptSet(raw);
  assert.equal(scripts.length, 5);
  for (const script of scripts) {
    const timeline = buildTimeline(script, 30);
    assert.ok(timeline.totalMs >= 15000 && timeline.totalMs <= 30000);
  }
});
