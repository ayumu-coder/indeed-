import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { ConfigError } from './env.ts';
import { createLogger } from './logger.ts';
import { USAGE, UsageError, groupInputs, parseArgs } from './joblisting/cli.ts';
import { loadJobListingConfig } from './joblisting/config.ts';
import { createAnthropicExtractor } from './joblisting/extractor.ts';
import { buildJobListingSheet } from './usecase/build-job-listing-sheet.ts';

/**
 * PDF・画像・テキストの求人資料を、Indeedの求人入力シート (.xlsx) にまとめる。
 *
 *   npm run joblisting -- --out out.xlsx job.pdf photo.jpg    # 全資料で1求人
 *   npm run joblisting -- --out out.xlsx --split a.pdf b.pdf  # 1資料につき1求人
 */
async function main(): Promise<void> {
  const logger = createLogger();
  const options = parseArgs(process.argv.slice(2));
  const config = loadJobListingConfig(process.env);
  const templatePath = options.templatePath ?? config.templatePath;

  const result = await buildJobListingSheet(
    { template: await readFile(templatePath), groups: groupInputs(options) },
    {
      extractor: createAnthropicExtractor({
        client: new Anthropic({ apiKey: config.apiKey }),
        model: config.model,
        maxTokens: config.maxTokens,
      }),
      logger,
    },
  );

  await writeFile(options.outPath, result.workbook);
  logger.info('workbook written', {
    out: options.outPath,
    template: templatePath,
    rows: result.rowCount,
    model: config.model,
  });
}

await main().catch((error: unknown) => {
  // A usage or configuration mistake is the operator's to fix, so keep it readable and quiet.
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  createLogger(process.stderr).error('fatal', {
    detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exitCode = 1;
});
