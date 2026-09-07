/**
 * One-time check that LINE_TO really is the person you think it is.
 *
 *   LINE_CHANNEL_ACCESS_TOKEN=... LINE_TO=U... npm run line:verify
 *
 * Optionally pushes a test message: `npm run line:verify -- --send`.
 */
import { fetchLineProfile, LinePushNotifier, DEFAULT_LINE_OPTIONS } from '../src/line/line-notifier.ts';
import { createLogger } from '../src/logger.ts';
import { deterministicRetryKey } from '../src/line/retry-key.ts';

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (value === undefined || value === '') throw new Error(`Missing env var: ${key}`);
  return value;
}

async function main(): Promise<void> {
  const token = requireEnv('LINE_CHANNEL_ACCESS_TOKEN');
  const to = requireEnv('LINE_TO');
  const expected = process.env['LINE_EXPECTED_DISPLAY_NAME']?.trim() ?? '';

  if (to.startsWith('U')) {
    const profile = await fetchLineProfile(token, to);
    process.stdout.write(`displayName: ${profile.displayName}\n`);
    if (expected !== '' && profile.displayName !== expected) {
      throw new Error(`LINE_TO belongs to "${profile.displayName}", not "${expected}"`);
    }
  } else {
    // Group and room ids have no profile endpoint; the test push is the only check.
    process.stdout.write(`${to} is a group/room id — profile lookup is not available.\n`);
  }

  if (process.argv.includes('--send')) {
    const notifier = new LinePushNotifier(
      { channelAccessToken: token, to, ...DEFAULT_LINE_OPTIONS },
      createLogger(process.stderr),
    );
    const text = '✅ 接続テスト: メール自動転送の設定が完了しました。';
    await notifier.push(text, deterministicRetryKey(`verify:${new Date().toISOString()}`));
    process.stdout.write('test message sent\n');
  }
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
