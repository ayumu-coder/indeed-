/**
 * One-time local setup: exchanges a Google OAuth consent for a refresh token.
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run authorize [reminder|forward|all]
 *
 * The scope set defaults to `reminder`. Use `forward` for the LINE forwarder
 * (mailbox read + label), or `all` for one token that serves both jobs.
 *
 * Prints the refresh token to stdout. Store it as the GOOGLE_REFRESH_TOKEN secret;
 * never commit it.
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createOAuthClient, isScopeSetName, SCOPE_SETS } from '../src/google/auth.ts';

const PORT = Number(process.env['OAUTH_PORT'] ?? 53_682);
const REDIRECT_URI = `http://localhost:${PORT}`;

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (value === undefined || value === '') throw new Error(`Missing env var: ${key}`);
  return value;
}

async function waitForCode(): Promise<string> {
  const server = createServer();
  const codePromise = new Promise<string>((resolvePromise, rejectPromise) => {
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', REDIRECT_URI);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(code === null ? `認証に失敗しました: ${error ?? 'unknown'}` : '認証が完了しました。このタブを閉じてください。');
      if (code === null) rejectPromise(new Error(`Authorization failed: ${error ?? 'unknown'}`));
      else resolvePromise(code);
    });
  });

  server.listen(PORT);
  await once(server, 'listening');
  try {
    return await codePromise;
  } finally {
    server.close();
  }
}

function resolveScopes(): readonly string[] {
  const requested = process.argv[2] ?? 'reminder';
  if (!isScopeSetName(requested)) {
    throw new Error(`Unknown scope set: ${requested} (expected reminder | forward | all)`);
  }
  return SCOPE_SETS[requested];
}

async function main(): Promise<void> {
  const scopes = resolveScopes();
  const client = createOAuthClient(
    { clientId: requireEnv('GOOGLE_CLIENT_ID'), clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'), refreshToken: '' },
    REDIRECT_URI,
  );

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...scopes],
  });

  process.stdout.write(`\n要求スコープ:\n${scopes.map((scope) => `  - ${scope}`).join('\n')}\n`);
  process.stdout.write(`\nブラウザで次の URL を開いて許可してください:\n\n${url}\n\n`);

  const code = await waitForCode();
  const { tokens } = await client.getToken({ code, redirect_uri: REDIRECT_URI });

  if (typeof tokens.refresh_token !== 'string' || tokens.refresh_token === '') {
    throw new Error('No refresh token returned. Revoke the app at myaccount.google.com/permissions and retry.');
  }
  process.stdout.write(`\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n\n`);
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
