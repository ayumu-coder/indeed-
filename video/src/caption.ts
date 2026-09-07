import type { Caption, Narration } from './types.ts';
import { plainLength } from './validate.ts';

/** 1 行あたりの上限文字数。縦型 1080px 幅で 2 行に収まる長さ。 */
export const MAX_CAPTION_CHARS = 24;

const SPLIT_AFTER = new Set(['。', '、', '！', '？', '．', '，']);

/**
 * ナレーションを字幕の表示単位に分割する。
 * 句読点で切り、上限文字数を超えない範囲で連結する。強調記号 `**` は保持する。
 */
export function splitIntoChunks(text: Narration, maxChars: number = MAX_CAPTION_CHARS): readonly string[] {
  const clauses: string[] = [];
  let current = '';
  let emphasised = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '*' && text[index + 1] === '*') {
      emphasised = !emphasised;
      current += '**';
      index += 1;
      continue;
    }
    current += char;
    // 強調の途中では切らない（記号の対応が壊れるため）。
    if (SPLIT_AFTER.has(char) && !emphasised) {
      clauses.push(current);
      current = '';
    }
  }
  if (current.length > 0) clauses.push(current);

  const chunks: string[] = [];
  let buffer = '';
  for (const clause of clauses) {
    if (buffer.length === 0) {
      buffer = clause;
      continue;
    }
    if (plainLength(buffer) + plainLength(clause) <= maxChars) {
      buffer += clause;
    } else {
      chunks.push(buffer);
      buffer = clause;
    }
  }
  if (buffer.length > 0) chunks.push(buffer);

  return chunks.length > 0 ? chunks : [text];
}

/**
 * 分割した字幕にセクション尺を文字数比で配分する。
 * 端数はすべて最終チャンクに寄せ、合計が必ず durationMs と一致する。
 */
export function layoutCaptions(text: Narration, startMs: number, durationMs: number): readonly Caption[] {
  const chunks = splitIntoChunks(text);
  const weights = chunks.map((chunk) => Math.max(plainLength(chunk), 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const captions: Caption[] = [];
  let cursor = startMs;
  for (let index = 0; index < chunks.length; index += 1) {
    const isLast = index === chunks.length - 1;
    const weight = weights[index] ?? 1;
    const slice = isLast
      ? startMs + durationMs - cursor
      : Math.round((durationMs * weight) / totalWeight);
    captions.push({ text: chunks[index] ?? '', startMs: cursor, endMs: cursor + slice });
    cursor += slice;
  }
  return captions;
}
