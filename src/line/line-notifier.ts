import type { Logger, Notifier } from '../ports.ts';

const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const PROFILE_ENDPOINT = 'https://api.line.me/v2/bot/profile';

/** 429 and 5xx are worth another attempt; 400/401/403 are configuration errors. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

export class LinePushError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`LINE push failed: ${String(status)} ${body}`);
    this.status = status;
  }
}

export interface LineNotifierOptions {
  readonly channelAccessToken: string;
  readonly to: string;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
}

export const DEFAULT_LINE_OPTIONS = { maxAttempts: 3, baseDelayMs: 1_000 } as const;

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function retryDelayMs(attempt: number, baseDelayMs: number, retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 30) * 1_000;
  // Exponential backoff with jitter, so parallel runs do not retry in lockstep.
  return baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs);
}

export class LinePushNotifier implements Notifier {
  readonly #options: LineNotifierOptions;
  readonly #logger: Logger;

  constructor(options: LineNotifierOptions, logger: Logger) {
    this.#options = options;
    this.#logger = logger;
  }

  async push(text: string, idempotencyKey: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.#options.maxAttempts; attempt += 1) {
      const response = await fetch(PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#options.channelAccessToken}`,
          'content-type': 'application/json',
          'x-line-retry-key': idempotencyKey,
        },
        body: JSON.stringify({ to: this.#options.to, messages: [{ type: 'text', text }] }),
      });

      if (response.ok) return;

      const body = (await response.text()).slice(0, 500);
      lastError = new LinePushError(response.status, body);
      if (!RETRYABLE_STATUSES.has(response.status)) break;

      const delay = retryDelayMs(attempt, this.#options.baseDelayMs, response.headers.get('retry-after'));
      this.#logger.warn('line push retry', { status: response.status, attempt: attempt + 1, delayMs: delay });
      await sleep(delay);
    }
    throw lastError instanceof Error ? lastError : new Error('LINE push failed');
  }
}

export interface LineProfile {
  readonly displayName: string;
  readonly userId: string;
}

/** Only user ids have a profile; group and room ids return 404 by design. */
export async function fetchLineProfile(channelAccessToken: string, userId: string): Promise<LineProfile> {
  const response = await fetch(`${PROFILE_ENDPOINT}/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${channelAccessToken}` },
  });
  if (!response.ok) throw new LinePushError(response.status, (await response.text()).slice(0, 500));
  const data = (await response.json()) as { displayName?: unknown; userId?: unknown };
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    userId: typeof data.userId === 'string' ? data.userId : userId,
  };
}

/** Used by `DRY_RUN=true`; prints the message that would be pushed. */
export class ConsoleNotifier implements Notifier {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  push(text: string, idempotencyKey: string): Promise<void> {
    this.#logger.info('would push to LINE', { idempotencyKey, text });
    return Promise.resolve();
  }
}
