import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { numberFromEnv, stringFromEnv } from './env.ts';
import { probeDurationMs } from './ffmpeg.ts';
import { SECTION_NAMES, type SectionName, type ShortScript } from './types.ts';

export interface NarrationClip {
  readonly section: SectionName;
  readonly path: string;
  readonly durationMs: number;
}

export interface TtsEngine {
  readonly name: string;
  /** 与えたテキストを WAV として outputPath に書き出す。 */
  synthesize(text: string, outputPath: string): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * VOICEVOX ENGINE (HTTP)
 * ------------------------------------------------------------------ */

export interface VoicevoxConfig {
  readonly baseUrl: string;
  readonly speakerId: number;
  readonly speedScale: number;
}

export function createVoicevoxEngine(config: VoicevoxConfig): TtsEngine {
  return {
    name: `voicevox(speaker=${config.speakerId}, speed=${config.speedScale})`,
    async synthesize(text: string, outputPath: string): Promise<void> {
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
    },
  };
}

/* ------------------------------------------------------------------ *
 * Open JTalk (ローカル CLI)
 * ------------------------------------------------------------------ */

export interface OpenJTalkConfig {
  readonly binary: string;
  readonly dictionaryDir: string;
  readonly voicePath: string;
  /** 話速。ショート動画は 1.7〜1.9 あたりが読みやすい。 */
  readonly rate: number;
  /** 声質パラメータ（0.0〜1.0）。小さいほど硬い声になる。 */
  readonly alpha: number;
  /** 追加ピッチ（半音ではなくログ基本周波数のシフト量）。 */
  readonly pitch: number;
  readonly volumeDb: number;
}

const DICTIONARY_CANDIDATES: readonly string[] = [
  '/var/lib/mecab/dic/open-jtalk/naist-jdic',
  '/usr/local/dic',
  '/usr/share/open-jtalk/dic',
  '/opt/homebrew/opt/open-jtalk/dic',
];

const VOICE_CANDIDATES: readonly string[] = [
  '/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice',
  '/usr/share/hts-voice/mei/mei_normal.htsvoice',
  '/opt/homebrew/opt/open-jtalk/voice/m100/nitech_jp_atr503_m001.htsvoice',
];

function firstExisting(candidates: readonly string[]): string | null {
  return candidates.find((path) => existsSync(path)) ?? null;
}

export function createOpenJTalkEngine(config: OpenJTalkConfig): TtsEngine {
  return {
    name: `openjtalk(rate=${config.rate})`,
    async synthesize(text: string, outputPath: string): Promise<void> {
      // open_jtalk は標準入力を受け付けないため、テキストを一時ファイルに落とす。
      const textPath = `${outputPath}.txt`;
      await writeFile(textPath, text, 'utf8');
      const args = [
        '-x', config.dictionaryDir,
        '-m', config.voicePath,
        '-ow', outputPath,
        '-r', String(config.rate),
        '-a', String(config.alpha),
        '-fm', String(config.pitch),
        '-g', String(config.volumeDb),
        textPath,
      ];
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(config.binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('error', rejectPromise);
        child.on('close', (code) =>
          code === 0
            ? resolvePromise()
            : rejectPromise(new Error(`open_jtalk が終了コード ${String(code)} で失敗:\n${stderr}`)),
        );
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * 選択
 * ------------------------------------------------------------------ */

/**
 * 使用する音声合成エンジンを決める。
 * `TTS_ENGINE` で明示指定、未指定なら VOICEVOX → Open JTalk → 無音 の順で自動選択する。
 */
export function resolveTtsEngine(): TtsEngine | null {
  const requested = stringFromEnv('TTS_ENGINE') ?? 'auto';
  if (requested === 'none') return null;

  const voicevoxUrl = stringFromEnv('VOICEVOX_URL');
  if ((requested === 'auto' || requested === 'voicevox') && voicevoxUrl !== null) {
    return createVoicevoxEngine({
      baseUrl: voicevoxUrl.replace(/\/$/, ''),
      speakerId: numberFromEnv('VOICEVOX_SPEAKER', 3),
      speedScale: numberFromEnv('VOICEVOX_SPEED', 1.15),
    });
  }
  if (requested === 'voicevox') {
    throw new Error('TTS_ENGINE=voicevox には VOICEVOX_URL の指定が必要です');
  }

  if (requested === 'auto' || requested === 'openjtalk') {
    const binary = stringFromEnv('OPENJTALK_BIN') ?? 'open_jtalk';
    const dictionaryDir = stringFromEnv('OPENJTALK_DIC') ?? firstExisting(DICTIONARY_CANDIDATES);
    const voicePath = stringFromEnv('OPENJTALK_VOICE') ?? firstExisting(VOICE_CANDIDATES);
    if (dictionaryDir !== null && voicePath !== null) {
      return createOpenJTalkEngine({
        binary,
        dictionaryDir,
        voicePath,
        rate: numberFromEnv('OPENJTALK_RATE', 1.8),
        alpha: numberFromEnv('OPENJTALK_ALPHA', 0.5),
        pitch: numberFromEnv('OPENJTALK_PITCH', 0),
        volumeDb: numberFromEnv('OPENJTALK_VOLUME', 3),
      });
    }
    if (requested === 'openjtalk') {
      throw new Error('open_jtalk の辞書または音声ファイルが見つかりません（OPENJTALK_DIC / OPENJTALK_VOICE）');
    }
  }
  return null;
}

/**
 * セクションごとに音声を合成する。
 * 1 つでも失敗したら null を返し、無音トラックにフォールバックする（描画は必ず完走させる）。
 */
export async function synthesizeNarration(
  script: ShortScript,
  engine: TtsEngine,
  workDir: string,
): Promise<readonly NarrationClip[] | null> {
  try {
    const clips: NarrationClip[] = [];
    for (const section of SECTION_NAMES) {
      const path = join(workDir, `${script.id}-${section}.wav`);
      await engine.synthesize(script.script[section].replace(/\*\*/g, ''), path);
      clips.push({ section, path, durationMs: await probeDurationMs(path) });
    }
    return clips;
  } catch (error) {
    process.stderr.write(`[tts] 音声合成をスキップします (${String(error)})\n`);
    return null;
  }
}
