import { google } from 'googleapis';
import type { JWT, OAuth2Client } from 'google-auth-library';
import type { GoogleAuthConfig } from '../config.ts';

/** Sheets read/write plus send-only Gmail. Neither grants read access to a mailbox. */
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
  // Read-only access to "Send mail as" settings, so a From address can be checked
  // against the account's verified aliases before anything is sent. Grants no
  // access to message content.
  'https://www.googleapis.com/auth/gmail.settings.basic',
] as const;

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/**
 * Builds the client used to read and write the spreadsheet.
 *
 * In service-account mode this is the service account's own identity, so the
 * spreadsheet must be shared with its address. In OAuth mode it is the user who
 * ran `npm run authorize`.
 */
export function createSheetsAuth(config: GoogleAuthConfig): OAuth2Client {
  if (config.mode === 'serviceAccount') {
    return new google.auth.JWT({
      email: config.key.client_email,
      key: config.key.private_key,
      scopes: [SHEETS_SCOPE],
    });
  }
  return createOAuthClient(config);
}

/**
 * Builds a Gmail client that sends **as** `subject`.
 *
 * Requires Workspace domain-wide delegation: the service account's client ID must be
 * authorised for the gmail.send scope in the Admin console, and `subject` must be a
 * user in that Workspace. This is what makes each reminder come from the 担当者
 * rather than from one shared robot address.
 */
export function createImpersonatedGmailAuth(
  config: Extract<GoogleAuthConfig, { mode: 'serviceAccount' }>,
  subject: string,
): JWT {
  return new google.auth.JWT({
    email: config.key.client_email,
    key: config.key.private_key,
    scopes: [GMAIL_SEND_SCOPE],
    subject,
  });
}

export function createOAuthClient(
  config: Extract<GoogleAuthConfig, { mode: 'oauth' }>,
  redirectUri?: string,
): OAuth2Client {
  const client = new google.auth.OAuth2({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    ...(redirectUri === undefined ? {} : { redirectUri }),
  });
  if (config.refreshToken !== '') client.setCredentials({ refresh_token: config.refreshToken });
  return client;
}
