import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { mixNarration, openEncoder } from './ffmpeg.ts';
import { buildPage } from './page.ts';
import { toNarrationText, toSrt } from './srt.ts';
import { buildTimeline, frameCount, type SectionDurations } from './timeline.ts';
import { NOMINAL_SECTION_MS, type RenderOptions, type SectionName, type ShortScript, type Timeline } from './types.ts';
import { synthesizeNarration, ttsConfigFromEnv } from './tts.ts';

export interface RenderResult {
  readonly id: string;
  readonly videoPath: string;
  readonly srtPath: string;
  readonly timeline: Timeline;
  readonly frames: number;
  readonly withNarration: boolean;
  readonly elapsedMs: number;
}

/** 字幕を読み切れるように、合成音声の実測尺へ余白を足したものをセクション尺にする。 */
const TAIL_PADDING_MS = 260;

function durationsFrom(clips: readonly { section: SectionName; durationMs: number }[]): SectionDurations {
  const base: Record<SectionName, number> = { ...NOMINAL_SECTION_MS };
  for (const clip of clips) base[clip.section] = clip.durationMs + TAIL_PADDING_MS;
  return base;
}

export interface RenderContext {
  readonly browser: Browser;
  readonly options: RenderOptions;
  readonly fontFaceCss: string;
}

export async function openBrowser(): Promise<Browser> {
  return await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
}

/** 台本 1 本を MP4 と SRT に書き出す。 */
export async function renderScript(context: RenderContext, script: ShortScript): Promise<RenderResult> {
  const startedAt = Date.now();
  const { options, browser, fontFaceCss } = context;
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const workDir = await mkdtemp(join(tmpdir(), `short-${script.id}-`));

  try {
    const ttsConfig = ttsConfigFromEnv();
    const clips = ttsConfig === null ? null : await synthesizeNarration(script, ttsConfig, workDir);
    const timeline = buildTimeline(script, options.fps, clips === null ? NOMINAL_SECTION_MS : durationsFrom(clips));

    const pagePath = join(workDir, 'page.html');
    await writeFile(pagePath, buildPage({ script, timeline, fontFaceCss, ...sizeOf(options) }), 'utf8');

    let audioPath: string | null = null;
    if (clips !== null) {
      audioPath = join(workDir, 'narration.m4a');
      const offsets = timeline.sections.map((section) => ({
        path: clips.find((clip) => clip.section === section.name)?.path ?? '',
        offsetMs: Math.round(section.startMs),
      }));
      await mixNarration(offsets, timeline.totalMs, audioPath);
    }

    const videoPath = join(outDir, `${script.id}.mp4`);
    const encoder = openEncoder({
      fps: options.fps,
      crf: options.crf,
      outputPath: videoPath,
      audioPath,
      durationMs: timeline.totalMs,
    });

    const page: Page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });
    try {
      await page.goto(`file://${pagePath}`, { waitUntil: 'load' });
      // DOM の型に依存しないよう、評価は文字列式で行う（tsconfig の lib は ES2023 のみ）。
      await page.evaluate<boolean>('document.fonts.ready.then(() => true)');

      const frames = frameCount(timeline);
      const frameMs = 1000 / options.fps;
      for (let index = 0; index < frames; index += 1) {
        await page.evaluate<null>(`window.__seek(${index * frameMs}); null`);
        await encoder.write(await page.screenshot({ type: 'jpeg', quality: 92 }));
      }
      await encoder.finish();

      const srtPath = join(outDir, `${script.id}.srt`);
      await writeFile(srtPath, toSrt(timeline), 'utf8');
      await writeFile(join(outDir, `${script.id}.txt`), buildCaptionFile(script, timeline), 'utf8');

      return {
        id: script.id,
        videoPath,
        srtPath,
        timeline,
        frames,
        withNarration: clips !== null,
        elapsedMs: Date.now() - startedAt,
      };
    } finally {
      await page.close();
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function sizeOf(options: RenderOptions): { width: number; height: number } {
  return { width: options.width, height: options.height };
}

/** そのまま投稿欄へ貼れるキャプション。 */
function buildCaptionFile(script: ShortScript, timeline: Timeline): string {
  return [
    script.title,
    '',
    toNarrationText(timeline),
    '',
    script.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '),
    '',
    script.disclaimer,
  ].join('\n');
}
