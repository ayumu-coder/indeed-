import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeDurationMs } from './ffmpeg.ts';
import { SECTION_NAMES, type SectionName, type ShortScript } from './types.ts';

export interface NarrationClip {
  readonly section: SectionName;
  readonly path: string;
  readonly durationMs: number;
}

export interface TtsConfig {
  /** VOICEVOX ENGINE の URL。未設定なら音声合成をスキップする。 */
  readonly baseUrl: string;
  readonly speakerId: number;
  readonly speedScale: number;
}

export function ttsConfigFromEnv(): TtsConfig | null {
  const baseUrl = process.env['VOICEVOX_URL'];
  if (baseUrl === undefined || baseUrl.length === 0) return null;
  const speakerId = Number(process.env['VOICEVOX_SPEAKER'] ?? '3');
  const speedScale = Number(process.env['VOICEVOX_SPEED'] ?? '1.15');
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    speakerId: Number.isFinite(speakerId) ? speakerId : 3,
    speedScale: Number.isFinite(speedScale) ? speedScale : 1.15,
  };
}

async function synthesizeOne(
  config: TtsConfig,
  text: string,
  outputPath: string,
): Promise<void> {
  const query = await fetch(
    `${config.baseUrl}/audio_query?speaker=${config.speakerId}&text=${encodeURIComponent(text)}`,
    { method: 'POST' },
  );
  if (!query.ok) throw new Error(`audio_query に失敗: ${query.status}`);

  const parsed: unknown = await query.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('audio_query の応答が不正です');
  const tuned = { ...parsed, speedScale: config.speedScale, outputSamplingRate: 44100 };

  const synthesis = await fetch(`${config.baseUrl}/synthesis?speaker=${config.speakerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tuned),
  });
  if (!synthesis.ok) throw new Error(`synthesis に失敗: ${synthesis.status}`);
  await writeFile(outputPath, Buffer.from(await synthesis.arrayBuffer()));
}

/** セクションごとに音声を合成する。1 つでも失敗したら null を返し、無音動画にフォールバックする。 */
export async function synthesizeNarration(
  script: ShortScript,
  config: TtsConfig,
  workDir: string,
): Promise<readonly NarrationClip[] | null> {
  try {
    const clips: NarrationClip[] = [];
    for (const section of SECTION_NAMES) {
      const path = join(workDir, `${script.id}-${section}.wav`);
      await synthesizeOne(config, script.script[section].replace(/\*\*/g, ''), path);
      clips.push({ section, path, durationMs: await probeDurationMs(path) });
    }
    return clips;
  } catch (error) {
    process.stderr.write(`[tts] 音声合成をスキップします (${String(error)})\n`);
    return null;
  }
}
