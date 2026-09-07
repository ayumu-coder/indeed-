import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseScriptSet, ScriptValidationError } from '../validate.ts';
import {
  instagramConfigFromEnv,
  isDryRun,
  MissingConfigError,
  shareToFeedFromEnv,
  storageConfigFromEnv,
} from './config.ts';
import { createInstagramPublisher, GraphApiError } from './instagram.ts';
import { buildObjectKey } from './object-key.ts';
import { createS3Storage } from './s3-storage.ts';

interface PublishArgs {
  readonly scriptsPath: string;
  readonly outDir: string;
  readonly only: readonly string[];
}

function parseArgs(argv: readonly string[]): PublishArgs {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match !== null) flags.set(match[1] ?? '', match[2] ?? 'true');
  }
  return {
    scriptsPath: flags.get('scripts') ?? 'video/data/scripts.json',
    outDir: flags.get('out') ?? 'video/out',
    only: (flags.get('only') ?? '').split(',').filter((id) => id.length > 0),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw: unknown = JSON.parse(await readFile(resolve(args.scriptsPath), 'utf8'));
  const all = parseScriptSet(raw);
  const targets = args.only.length === 0 ? all : all.filter((script) => args.only.includes(script.id));
  if (targets.length === 0) throw new Error(`対象の台本がありません: --only=${args.only.join(',')}`);

  const dryRun = isDryRun();
  const outDir = resolve(args.outDir);

  // 先に全ファイルの存在を確認する。途中まで投稿して失敗するのが一番厄介なため。
  const jobs = await Promise.all(
    targets.map(async (script) => {
      const videoPath = join(outDir, `${script.id}.mp4`);
      const captionPath = join(outDir, `${script.id}.txt`);
      if (!existsSync(videoPath)) throw new Error(`動画がありません: ${videoPath} (先に npm run video:render)`);
      if (!existsSync(captionPath)) throw new Error(`キャプションがありません: ${captionPath}`);
      const content = await readFile(videoPath);
      return {
        id: script.id,
        videoPath,
        content,
        caption: (await readFile(captionPath, 'utf8')).trim(),
        key: buildObjectKey(script.id, content, new Date()),
      };
    }),
  );

  if (dryRun) {
    process.stdout.write('DRY_RUN=true のため、アップロードも投稿も行いません。\n\n');
    for (const job of jobs) {
      process.stdout.write(
        `${job.id}\n  file    : ${job.videoPath} (${(job.content.byteLength / 1_048_576).toFixed(1)} MB)\n`
          + `  key     : ${job.key}\n  caption : ${job.caption.length} 文字\n`,
      );
    }
    process.stdout.write('\n実際に投稿するには DRY_RUN=false を設定してください。\n');
    return;
  }

  const storage = createS3Storage(storageConfigFromEnv());
  const publisher = createInstagramPublisher(instagramConfigFromEnv());
  const shareToFeed = shareToFeedFromEnv();

  const quota = await publisher.quota();
  process.stdout.write(`投稿枠: ${quota.used}/${quota.limit} 使用済み（残り ${quota.remaining}）\n`);
  if (quota.remaining < jobs.length) {
    throw new Error(`残り枠 ${quota.remaining} 件に対して ${jobs.length} 件を投稿しようとしています`);
  }

  for (const job of jobs) {
    process.stdout.write(`▶ ${job.id} をアップロード中...\n`);
    const stored = await storage.put(job.videoPath, job.key, 'video/mp4');
    process.stdout.write(`  保存: ${stored.key}（URL 期限 ${stored.expiresAt.toISOString()}）\n`);

    const result = await publisher.publish({
      videoUrl: stored.url,
      caption: job.caption,
      shareToFeed,
    });
    process.stdout.write(`  公開: media_id=${result.mediaId}\n`);
  }
  process.stdout.write(`\n完了: ${jobs.length} 件を投稿しました。\n`);
}

main().catch((error: unknown) => {
  if (error instanceof MissingConfigError || error instanceof ScriptValidationError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof GraphApiError) {
    process.stderr.write(`Graph API エラー (status=${error.status}, code=${error.code ?? '-'}): ${error.message}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
