import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { GoogleCredentials } from '../config.ts';

/** Reminder job: read/write the one spreadsheet, and send mail. No mailbox read. */
export const SCOPES_REMINDER = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

/**
 * LINE forwarder: read the mailbox and add its bookkeeping label.
 * `gmail.modify` is the narrowest scope that can label; `gmail.readonly` cannot,
 * and without a durable label there is nothing to dedupe against.
 */
export const SCOPES_FORWARD = ['https://www.googleapis.com/auth/gmail.modify'] as const;

export const SCOPE_SETS = {
  reminder: SCOPES_REMINDER,
  forward: SCOPES_FORWARD,
  all: [...SCOPES_REMINDER, ...SCOPES_FORWARD],
} as const satisfies Record<string, readonly string[]>;

export type ScopeSetName = keyof typeof SCOPE_SETS;

export function isScopeSetName(value: string): value is ScopeSetName {
  return Object.hasOwn(SCOPE_SETS, value);
}

/** Kept for the existing reminder flow's default. */
export const SCOPES = SCOPES_REMINDER;

export function createOAuthClient(
  credentials: GoogleCredentials,
  redirectUri?: string,
): OAuth2Client {
  const client = new google.auth.OAuth2({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    ...(redirectUri === undefined ? {} : { redirectUri }),
  });
  if (credentials.refreshToken !== '') {
    client.setCredentials({ refresh_token: credentials.refreshToken });
  }
  return client;
}
