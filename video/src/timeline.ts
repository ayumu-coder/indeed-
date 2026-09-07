import { layoutCaptions } from './caption.ts';
import {
  NOMINAL_SECTION_MS,
  SECTION_NAMES,
  type Section,
  type SectionName,
  type ShortScript,
  type Timeline,
} from './types.ts';

export type SectionDurations = Readonly<Record<SectionName, number>>;

/**
 * 台本とセクション尺からタイムラインを組み立てる純関数。
 * `durations` を渡すと（TTS の実測尺など）既定尺を上書きする。
 */
export function buildTimeline(
  script: ShortScript,
  fps: number,
  durations: SectionDurations = NOMINAL_SECTION_MS,
): Timeline {
  const frameMs = 1000 / fps;
  let cursor = 0;
  const sections: Section[] = [];

  for (const name of SECTION_NAMES) {
    // フレーム境界に丸め、シークとエンコードのズレをなくす。
    const durationMs = Math.max(Math.round(durations[name] / frameMs) * frameMs, frameMs);
    sections.push({
      name,
      text: script.script[name],
      startMs: cursor,
      durationMs,
      captions: layoutCaptions(script.script[name], cursor, durationMs),
    });
    cursor += durationMs;
  }

  return { id: script.id, fps, totalMs: cursor, sections };
}

export function frameCount(timeline: Timeline): number {
  return Math.round((timeline.totalMs / 1000) * timeline.fps);
}

export function sectionAt(timeline: Timeline, timeMs: number): Section {
  const found = timeline.sections.find(
    (section) => timeMs >= section.startMs && timeMs < section.startMs + section.durationMs,
  );
  const last = timeline.sections[timeline.sections.length - 1];
  if (found !== undefined) return found;
  if (last === undefined) throw new Error('タイムラインにセクションがありません');
  return last;
}
