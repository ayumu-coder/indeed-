import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** ffmpeg 実行ファイルの解決順: 明示指定 → ffmpeg-static → PATH。 */
export function resolveFfmpeg(): string {
  const fromEnv = process.env['FFMPEG_PATH'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  try {
    const resolved: unknown = require('ffmpeg-static');
    if (typeof resolved === 'string' && resolved.length > 0) return resolved;
  } catch {
    /* PATH にフォールバックする */
  }
  return 'ffmpeg';
}

export interface EncodeOptions {
  readonly fps: number;
  readonly crf: number;
  readonly outputPath: string;
  /** 無い場合は無音トラックを合成する。SNS 側の音声トラック欠落による不具合を避ける。 */
  readonly audioPath: string | null;
  readonly durationMs: number;
}

export interface FrameSink {
  /** JPEG フレームを 1 枚書き込む。バックプレッシャーに従う。 */
  write(frame: Buffer): Promise<void>;
  /** 入力を閉じ、エンコード完了を待つ。 */
  finish(): Promise<void>;
}

/**
 * JPEG フレームを stdin から受け取り H.264/AAC の MP4 を書き出す。
 * 中間 PNG をディスクに置かないぶん、フレーム数に対して I/O が線形に増えない。
 */
export function openEncoder(options: EncodeOptions): FrameSink {
  const { fps, crf, outputPath, audioPath, durationMs } = options;
  const seconds = (durationMs / 1000).toFixed(3);

  const args: string[] = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
  ];
  if (audioPath === null) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  } else {
    args.push('-i', audioPath);
  }
  args.push(
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf),
    '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-g', String(fps * 2),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-t', seconds, '-shortest', '-movflags', '+faststart',
    outputPath,
  );

  const child: ChildProcessByStdio<Writable, null, Readable> = spawn(resolveFfmpeg(), args, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exited = new Promise<void>((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`ffmpeg が終了コード ${String(code)} で失敗しました:\n${stderr}`));
    });
  });

  return {
    write(frame: Buffer): Promise<void> {
      return new Promise((resolvePromise, rejectPromise) => {
        // EPIPE（ffmpeg 側の異常終了）は exited 側で詳細付きの例外になる。
        child.stdin.write(frame, (error) => (error ? rejectPromise(error) : resolvePromise()));
      });
    },
    async finish(): Promise<void> {
      child.stdin.end();
      await exited;
    },
  };
}

export interface BackgroundMusic {
  readonly path: string;
  /** ナレーションに対する相対ゲイン。-26〜-18dB あたりが定番。 */
  readonly gainDb: number;
}

/**
 * 複数の WAV を指定オフセットに配置して 1 本の AAC 音声へまとめる。
 * 最後に loudnorm を通し、配信面のラウドネス（およそ -14 LUFS）に揃える。
 */
export async function mixNarration(
  clips: readonly { readonly path: string; readonly offsetMs: number }[],
  totalMs: number,
  outputPath: string,
  bgm: BackgroundMusic | null = null,
): Promise<void> {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const clip of clips) args.push('-i', clip.path);
  // BGM は尺が足りなければループさせる。
  if (bgm !== null) args.push('-stream_loop', '-1', '-i', bgm.path);

  const delays = clips
    .map((clip, index) => `[${index}:a]adelay=${clip.offsetMs}|${clip.offsetMs},apad[a${index}]`)
    .join(';');
  const merge = clips.map((_, index) => `[a${index}]`).join('');
  const voice = `${delays};${merge}amix=inputs=${clips.length}:normalize=0:duration=longest[voice]`;
  const filter =
    bgm === null
      ? `${voice};[voice]loudnorm=I=-14:TP=-1.5:LRA=11[out]`
      : `${voice};[${clips.length}:a]volume=${bgm.gainDb}dB[bgm];`
        + `[voice][bgm]amix=inputs=2:normalize=0:duration=first[mixed];`
        + `[mixed]loudnorm=I=-14:TP=-1.5:LRA=11[out]`;

  args.push(
    '-filter_complex', filter, '-map', '[out]',
    '-t', (totalMs / 1000).toFixed(3),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    outputPath,
  );

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(resolveFfmpeg(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`音声ミックスに失敗:\n${stderr}`)),
    );
  });
}

/** メディアの長さ（ms）。TTS の実測尺でタイムラインを組み直すために使う。 */
export async function probeDurationMs(path: string): Promise<number> {
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn(resolveFfmpeg(), ['-hide_banner', '-i', path], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (match === null) {
        rejectPromise(new Error(`長さを取得できません: ${path}`));
        return;
      }
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      resolvePromise(Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
    });
  });
}
