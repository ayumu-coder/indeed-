import type { Logger } from '../ports.ts';
import type { JobExtractor } from '../joblisting/extractor.ts';
import { normalisePosting, type JobPostingDraft } from '../joblisting/posting.ts';
import { fillTemplate, type SheetRow } from '../joblisting/workbook.ts';
import { loadSources } from '../joblisting/source.ts';

/** One row of the sheet and the documents it was read from. */
export interface PostingGroup {
  readonly label: string;
  readonly paths: readonly string[];
}

export interface BuildRequest {
  readonly template: Buffer;
  readonly groups: readonly PostingGroup[];
}

export interface BuildResult {
  readonly workbook: Buffer;
  readonly rowCount: number;
}

export interface BuildDependencies {
  readonly extractor: JobExtractor;
  readonly logger: Logger;
}

/**
 * Extracts one posting per group, drops anything Indeed would reject, and writes the
 * surviving values into the template. Rejected values and blank required fields are
 * logged rather than fixed up: a wrong value on a live posting costs more than a blank.
 */
export async function buildJobListingSheet(
  request: BuildRequest,
  dependencies: BuildDependencies,
): Promise<BuildResult> {
  const rows: SheetRow[] = [];

  for (const group of request.groups) {
    const sources = await loadSources(group.paths);
    dependencies.logger.info('extracting posting', {
      group: group.label,
      sources: sources.map((source) => source.name),
    });

    const draft: JobPostingDraft = await dependencies.extractor.extract(sources);
    const posting = normalisePosting(draft);

    for (const issue of posting.issues) {
      dependencies.logger.warn('value dropped', {
        group: group.label,
        field: issue.field,
        value: issue.value,
        reason: issue.reason,
      });
    }
    if (posting.missingRequired.length > 0) {
      dependencies.logger.warn('required fields left blank', {
        group: group.label,
        fields: posting.missingRequired,
      });
    }

    const filled = [...posting.values.values()].filter((values) => values.length > 0).length;
    dependencies.logger.info('posting normalised', { group: group.label, filledFields: filled });
    rows.push(posting.values);
  }

  return { workbook: fillTemplate(request.template, rows), rowCount: rows.length };
}
