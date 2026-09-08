import { ConfigError, integer, optional, required, type Env } from '../env.ts';

export interface JobListingConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly templatePath: string;
}

export const DEFAULT_MODEL = 'claude-opus-5';
export const DEFAULT_TEMPLATE_PATH = 'templates/indeed-job-upload.xlsx';

export function loadJobListingConfig(env: Env): JobListingConfig {
  const config: JobListingConfig = {
    apiKey: required(env, 'ANTHROPIC_API_KEY'),
    model: optional(env, 'ANTHROPIC_MODEL', DEFAULT_MODEL),
    maxTokens: integer(env, 'EXTRACTION_MAX_TOKENS', 16_000),
    templatePath: optional(env, 'INDEED_TEMPLATE_PATH', DEFAULT_TEMPLATE_PATH),
  };
  if (config.maxTokens < 1024) {
    throw new ConfigError(`EXTRACTION_MAX_TOKENS must be at least 1024, got ${config.maxTokens}`);
  }
  return config;
}
