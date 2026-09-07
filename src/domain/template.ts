import { formatJapanese } from './jst.ts';
import type { ReminderTarget } from './types.ts';

/**
 * Placeholders available in templates/reminder.{subject,body}.txt.
 * Unknown placeholders are left verbatim so a typo is visible in a dry run
 * instead of silently producing an empty sentence in a candidate's inbox.
 */
export type Placeholder =
  | 'candidateName'
  | 'company'
  | 'jobTitle'
  | 'owner'
  | 'interviewDate'
  | 'interviewTime'
  | 'interviewDateTime';

export interface RenderedMail {
  readonly subject: string;
  readonly body: string;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

export function buildPlaceholders(target: ReminderTarget): Readonly<Record<Placeholder, string>> {
  const interviewDate = formatJapanese(target.interviewDay);
  const interviewTime = target.interviewTime ?? '';
  return {
    candidateName: target.candidateName,
    company: target.company,
    jobTitle: target.jobTitle,
    owner: target.owner,
    interviewDate,
    interviewTime,
    interviewDateTime: interviewTime === '' ? interviewDate : `${interviewDate} ${interviewTime}`,
  };
}

function substitute(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? '') : whole,
  );
}

export function renderMail(
  templates: { readonly subject: string; readonly body: string },
  target: ReminderTarget,
): RenderedMail {
  const values = buildPlaceholders(target);
  return {
    // A subject must stay a single header line; a stray newline would let template
    // content inject arbitrary headers into the outgoing message.
    subject: substitute(templates.subject, values).replace(/[\r\n]+/g, ' ').trim(),
    body: substitute(templates.body, values).replace(/\r\n/g, '\n').trim(),
  };
}
