import Anthropic from '@anthropic-ai/sdk';
import { FIELDS, type FieldKey } from './schema.ts';
import type { JobPostingDraft } from './posting.ts';
import type { SourceDocument } from './source.ts';

/** Reads one job posting out of a set of source documents. */
export interface JobExtractor {
  extract(sources: readonly SourceDocument[]): Promise<JobPostingDraft>;
}

export class ExtractionError extends Error {}

const TOOL_NAME = 'submit_job_posting';

const SYSTEM_PROMPT = [
  'あなたは求人票をIndeedの一括アップロード用シートに転記する担当者です。',
  `与えられた資料を読み、${TOOL_NAME} ツールを呼び出して各項目を埋めてください。`,
  '',
  '厳守すること:',
  '- 資料に書かれていないことは推測せず、空文字列にすること。空欄は許容される。',
  '- 資料の表現をできるだけそのまま使い、要約や言い換えで情報を失わないこと。',
  '- 金額・時間・人数は数字のみ（例: 「月給25万円」→ 250000、「1,200円」→ 1200）。',
  '- 選択肢が決まっている項目は、指定された値と一字一句同じ文字列を使うこと。',
  '- 複数値を取る項目は「、」区切りで並べること。',
  '- 資料が複数ある場合は同一求人の情報として統合し、矛盾する場合は最も新しい／詳細な記述を採用すること。',
].join('\n');

/** One string property per column, so a missing value is an empty string rather than a guess. */
function buildInputSchema(): Anthropic.Tool.InputSchema {
  const properties: Record<string, { type: 'string'; description: string }> = {};
  for (const spec of FIELDS) {
    const allowed =
      spec.allowed === null ? '' : ` 次のいずれかのみ: ${spec.allowed.join(' / ')}。`;
    const multi = spec.multi ? ' 複数可、「、」区切り。' : '';
    properties[spec.key] = {
      type: 'string',
      description: `${spec.header}: ${spec.guidance}${allowed}${multi} 不明なら空文字列。`,
    };
  }
  return {
    type: 'object',
    properties,
    required: FIELDS.map((spec) => spec.key),
    additionalProperties: false,
  };
}

export interface AnthropicExtractorOptions {
  readonly client: Anthropic;
  readonly model: string;
  readonly maxTokens: number;
}

/**
 * Uses the Messages API's native PDF and image understanding, so scans and photos need no
 * separate OCR step. `strict` keeps the tool arguments schema-valid; `tool_choice: auto`
 * plus an explicit instruction is used instead of forcing the tool, because forced tool use
 * is rejected on some current models.
 */
export function createAnthropicExtractor(options: AnthropicExtractorOptions): JobExtractor {
  const inputSchema = buildInputSchema();

  return {
    async extract(sources) {
      if (sources.length === 0) throw new ExtractionError('No source documents supplied');

      const response = await options.client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens,
        system: SYSTEM_PROMPT,
        thinking: { type: 'adaptive' },
        tools: [
          {
            name: TOOL_NAME,
            description: 'Indeedの求人入力シート1行分の値を提出する。',
            strict: true,
            input_schema: inputSchema,
          },
        ],
        tool_choice: { type: 'auto' },
        messages: [
          {
            role: 'user',
            content: [
              ...sources.map((source) => source.block),
              {
                type: 'text',
                text: `上記 ${sources.length} 件の資料は1件の求人に関するものです。${TOOL_NAME} を1回だけ呼び出してください。`,
              },
            ],
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        throw new ExtractionError(
          `Model declined the request: ${response.stop_details?.explanation ?? 'no explanation given'}`,
        );
      }

      const call = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' && block.name === TOOL_NAME,
      );
      if (call === undefined) {
        throw new ExtractionError(
          `Model returned no ${TOOL_NAME} call (stop_reason: ${response.stop_reason ?? 'unknown'})`,
        );
      }
      return toDraft(call.input);
    },
  };
}

/** Keeps only known, non-empty string fields — the API's output is untrusted input here. */
export function toDraft(input: unknown): JobPostingDraft {
  if (typeof input !== 'object' || input === null) {
    throw new ExtractionError('Tool input was not an object');
  }
  const record = input as Record<string, unknown>;
  const draft: Partial<Record<FieldKey, string>> = {};
  for (const spec of FIELDS) {
    const value = record[spec.key];
    if (typeof value === 'string' && value.trim() !== '') draft[spec.key] = value;
  }
  return draft;
}
