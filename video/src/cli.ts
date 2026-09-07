import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureFonts } from './fonts.ts';
import { openBrowser, renderScript, type RenderResult } from './render.ts';
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from './types.ts';
import { parseScriptSet, ScriptValidationError, narrationCharCount } from './validate.ts';

interface CliArgs {
  readonly scriptsPath: string;
  readonly only: readonly string[];
  readonly validateOnly: boolean;
  readonly options: RenderOptions;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match === null) continue;
    flags.set(match[1] ?? '', match[2] ?? 'true');
  }
  const number = (key: string, fallback: number): number => {
    const raw = flags.get(key);
    const value = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const only = (flags.get('only') ?? '').split(',').filter((id) => id.length > 0);

  return {
    scriptsPath: flags.get('scripts') ?? 'video/data/scripts.json',
    only,
    validateOnly: flags.get('validate-only') === 'true',
    options: {
      fps: number('fps', DEFAULT_RENDER_OPTIONS.fps),
      width: number('width', DEFAULT_RENDER_OPTIONS.width),
      height: number('height', DEFAULT_RENDER_OPTIONS.height),
      crf: number('crf', DEFAULT_RENDER_OPTIONS.crf),
      outDir: flags.get('out') ?? DEFAULT_RENDER_OPTIONS.outDir,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw: unknown = JSON.parse(await readFile(resolve(args.scriptsPath), 'utf8'));
  const all = parseScriptSet(raw);
  const targets = args.only.length === 0 ? all : all.filter((script) => args.only.includes(script.id));

  if (targets.length === 0) {
    throw new Error(`対象の台本がありません: --only=${args.only.join(',')}`);
  }
  for (const script of targets) {
    process.stdout.write(`✓ ${script.id} (${script.hookType}, ${narrationCharCount(script)}文字)\n`);
  }
  if (args.validateOnly) return;

  const fontFaceCss = await ensureFonts('video/.cache/fonts');
  const browser = await openBrowser();
  const results: RenderResult[] = [];
  try {
    for (const script of targets) {
      process.stdout.write(`▶ ${script.id} を書き出し中...\n`);
      const result = await renderScript({ browser, options: args.options, fontFaceCss }, script);
      results.push(result);
      process.stdout.write(
        `  ${result.videoPath} (${(result.timeline.totalMs / 1000).toFixed(1)}秒 / ${result.frames}f / `
          + `${result.withNarration ? 'ナレーションあり' : '無音'} / ${(result.elapsedMs / 1000).toFixed(1)}秒)\n`,
      );
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(`\n完了: ${results.length} 本を ${resolve(args.options.outDir)} に出力しました。\n`);
}

main().catch((error: unknown) => {
  if (error instanceof ScriptValidationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
