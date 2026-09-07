import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutCaptions, splitIntoChunks, MAX_CAPTION_CHARS } from '../src/caption.ts';
import { plainLength } from '../src/validate.ts';

test('句読点で分割し、上限内なら連結する', () => {
  const chunks = splitIntoChunks('家賃、通信、保険、食費。気づけば残高は数万円。', 12);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(''), '家賃、通信、保険、食費。気づけば残高は数万円。');
  for (const chunk of chunks) {
    // 単独で上限を超える節はそのまま残す（欠落させない）ため、下限のみ検証する。
    assert.ok(chunk.length > 0);
  }
});

test('上限を超えない範囲で貪欲に連結する', () => {
  const chunks = splitIntoChunks('あ、い、う、え、お、か、き、く、け、こ、さ、し、す、せ、そ、', 10);
  for (const chunk of chunks) assert.ok(plainLength(chunk) <= 10 + 2);
});

test('強調記号は分割してもペアが壊れない', () => {
  const chunks = splitIntoChunks('手取りの**5%**を防衛費、**10%**を積立、残りを生活費に。');
  for (const chunk of chunks) {
    assert.equal((chunk.match(/\*\*/g)?.length ?? 0) % 2, 0, chunk);
  }
});

test('配分した字幕の尺は隙間なくセクション尺と一致する', () => {
  const captions = layoutCaptions('あああ。いいいい。ううううう。', 1000, 5000);
  assert.equal(captions[0]?.startMs, 1000);
  assert.equal(captions[captions.length - 1]?.endMs, 6000);
  for (let i = 1; i < captions.length; i += 1) {
    assert.equal(captions[i]?.startMs, captions[i - 1]?.endMs);
  }
});

test('分割不能な 1 文でも 1 件の字幕になる', () => {
  const captions = layoutCaptions('あ', 0, 1500);
  assert.equal(captions.length, 1);
  assert.equal(captions[0]?.endMs, 1500);
});

test('既定の上限は 2 行に収まる長さ', () => {
  assert.ok(MAX_CAPTION_CHARS <= 24);
});
