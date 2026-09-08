import { basename } from 'node:path';
import type { PostingGroup } from '../usecase/build-job-listing-sheet.ts';
import { supportedExtensions } from './source.ts';

export class UsageError extends Error {}

export interface CliOptions {
  readonly outPath: string;
  /** Overrides the configured template. null = use the configured one. */
  readonly templatePath: string | null;
  /** One posting per source file rather than one posting from all of them. */
  readonly split: boolean;
  readonly inputPaths: readonly string[];
}

export const USAGE = `使い方: npm run joblisting -- --out <出力.xlsx> [--split] [--template <雛形.xlsx>] <資料ファイル...>

  --out <path>       出力する .xlsx のパス（必須）
  --split            資料1件につき1求人として扱う（既定: 全資料で1求人）
  --template <path>  雛形 .xlsx（既定: templates/indeed-job-upload.xlsx / INDEED_TEMPLATE_PATH）

対応する資料の形式: ${supportedExtensions().join(', ')}
必要な環境変数: ANTHROPIC_API_KEY（任意: ANTHROPIC_MODEL, EXTRACTION_MAX_TOKENS, INDEED_TEMPLATE_PATH）`;

export function parseArgs(argv: readonly string[]): CliOptions {
  let outPath: string | null = null;
  let templatePath: string | null = null;
  let split = false;
  const inputPaths: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case '--out':
      case '--template': {
        const value = argv[index + 1];
        // Rejecting a flag-shaped value stops `--out --split file.pdf` from writing to "--split".
        if (value === undefined || value.startsWith('--')) {
          throw new UsageError(`${arg} にはパスを指定してください`);
        }
        if (arg === '--out') outPath = value;
        else templatePath = value;
        index += 1;
        break;
      }
      case '--split':
        split = true;
        break;
      default:
        if (arg.startsWith('--')) throw new UsageError(`不明なオプション: ${arg}`);
        inputPaths.push(arg);
    }
  }

  if (outPath === null) throw new UsageError('--out は必須です');
  if (inputPaths.length === 0) throw new UsageError('資料ファイルを1件以上指定してください');
  return { outPath, templatePath, split, inputPaths };
}

export function groupInputs(options: CliOptions): readonly PostingGroup[] {
  return options.split
    ? options.inputPaths.map((path) => ({ label: basename(path), paths: [path] }))
    : [{ label: 'posting-1', paths: options.inputPaths }];
}
