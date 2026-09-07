import type { Timeline } from './types.ts';

function timecode(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

/** 焼き込み字幕とは別に、投稿プラットフォーム側の字幕として使う SRT を書き出す。 */
export function toSrt(timeline: Timeline): string {
  const lines: string[] = [];
  let index = 1;
  for (const section of timeline.sections) {
    for (const caption of section.captions) {
      lines.push(
        String(index),
        `${timecode(caption.startMs)} --> ${timecode(caption.endMs)}`,
        caption.text.replace(/\*\*/g, ''),
        '',
      );
      index += 1;
    }
  }
  return lines.join('\n');
}

/** TTS へ渡す素のナレーション（セクション区切り）。 */
export function toNarrationText(timeline: Timeline): string {
  return timeline.sections.map((section) => section.text.replace(/\*\*/g, '')).join('\n');
}
