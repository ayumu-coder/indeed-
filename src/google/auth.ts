import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { GoogleCredentials } from '../config.ts';

/** Least-privilege scopes: read/write the one spreadsheet, and send mail. No mailbox read. */
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

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
