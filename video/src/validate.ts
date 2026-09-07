import {
  HOOK_TYPES,
  SECTION_NAMES,
  type HookType,
  type Narration,
  type ShortScript,
  type Visual,
} from './types.ts';

/**
 * プラットフォーム審査・景表法・金商法（投資助言）で問題になりうる表現。
 * 台本生成の段階で機械的に弾く。
 */
export const BANNED_PHRASES: readonly string[] = [
  '絶対',
  '必ず儲か',
  '確実に稼げ',
  '確実に儲か',
  '元本保証',
  '元本は保証',
  '放置で稼げ',
  '誰でも稼げ',
  'ノーリスク',
  '損しません',
  '必ず増え',
  '100%',
  '１００％',
];

/** ナレーション合計の許容文字数（強調記号・空白を除いた実文字数）。 */
export const NARRATION_MIN_CHARS = 140;
export const NARRATION_MAX_CHARS = 180;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const EMPHASIS_PATTERN = /\*\*/g;

export class ScriptValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`台本の検証に失敗しました:\n- ${issues.join('\n- ')}`);
    this.name = 'ScriptValidationError';
    this.issues = issues;
  }
}

/** `**強調**` 記号と空白を除いた表示文字数。 */
export function plainLength(text: Narration): number {
  return text.replace(EMPHASIS_PATTERN, '').replace(/\s/g, '').length;
}

export function narrationCharCount(script: ShortScript): number {
  return SECTION_NAMES.reduce((sum, name) => sum + plainLength(script.script[name]), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string, path: string, issues: string[]): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(`${path}.${key}: 空でない文字列が必要です`);
    return '';
  }
  return value;
}

function readStringArray(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    issues.push(`${path}.${key}: 空でない文字列の配列が必要です`);
    return [];
  }
  return value as readonly string[];
}

function readNumber(source: Record<string, unknown>, key: string, path: string, issues: string[]): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`${path}.${key}: 数値が必要です`);
    return 0;
  }
  return value;
}

function parseVisual(raw: unknown, path: string, issues: string[]): Visual {
  const fallback: Visual = { kind: 'bullets', items: [], caption: '' };
  if (!isRecord(raw)) {
    issues.push(`${path}: オブジェクトが必要です`);
    return fallback;
  }
  const caption = readString(raw, 'caption', path, issues);
  const kind = raw['kind'];

  if (kind === 'bullets') {
    return { kind, caption, items: readStringArray(raw, 'items', path, issues) };
  }
  if (kind === 'donut') {
    const slices = Array.isArray(raw['slices']) ? raw['slices'] : [];
    if (slices.length === 0) issues.push(`${path}.slices: 1 件以上必要です`);
    return {
      kind,
      caption,
      slices: slices.map((slice, index) => {
        const scope = `${path}.slices[${index}]`;
        if (!isRecord(slice)) {
          issues.push(`${scope}: オブジェクトが必要です`);
          return { label: '', percent: 0, amount: '' };
        }
        return {
          label: readString(slice, 'label', scope, issues),
          percent: readNumber(slice, 'percent', scope, issues),
          amount: readString(slice, 'amount', scope, issues),
        };
      }),
    };
  }
  if (kind === 'steps') {
    const items = Array.isArray(raw['items']) ? raw['items'] : [];
    if (items.length === 0) issues.push(`${path}.items: 1 件以上必要です`);
    return {
      kind,
      caption,
      items: items.map((item, index) => {
        const scope = `${path}.items[${index}]`;
        if (!isRecord(item)) {
          issues.push(`${scope}: オブジェクトが必要です`);
          return { label: '', detail: '' };
        }
        return {
          label: readString(item, 'label', scope, issues),
          detail: readString(item, 'detail', scope, issues),
        };
      }),
    };
  }
  if (kind === 'bars') {
    const items = Array.isArray(raw['items']) ? raw['items'] : [];
    if (items.length === 0) issues.push(`${path}.items: 1 件以上必要です`);
    return {
      kind,
      caption,
      items: items.map((item, index) => {
        const scope = `${path}.items[${index}]`;
        if (!isRecord(item)) {
          issues.push(`${scope}: オブジェクトが必要です`);
          return { label: '', value: 0, unit: '', accent: false };
        }
        return {
          label: readString(item, 'label', scope, issues),
          value: readNumber(item, 'value', scope, issues),
          unit: readString(item, 'unit', scope, issues),
          accent: item['accent'] === true,
        };
      }),
    };
  }

  issues.push(`${path}.kind: bullets | donut | steps | bars のいずれかが必要です (${String(kind)})`);
  return fallback;
}

function checkCompliance(script: ShortScript, path: string, issues: string[]): void {
  const surfaces: readonly string[] = [
    script.telopFirstFrame,
    script.ctaLabel,
    ...SECTION_NAMES.map((name) => script.script[name]),
  ];
  for (const phrase of BANNED_PHRASES) {
    if (surfaces.some((text) => text.includes(phrase))) {
      issues.push(`${path}: 禁止表現「${phrase}」が含まれています`);
    }
  }
  const total = narrationCharCount(script);
  if (total < NARRATION_MIN_CHARS || total > NARRATION_MAX_CHARS) {
    issues.push(
      `${path}: ナレーション合計 ${total} 文字。${NARRATION_MIN_CHARS}〜${NARRATION_MAX_CHARS} 文字に収めてください`,
    );
  }
  for (const name of SECTION_NAMES) {
    const marks = script.script[name].match(EMPHASIS_PATTERN)?.length ?? 0;
    if (marks % 2 !== 0) issues.push(`${path}.script.${name}: 強調記号 ** が閉じていません`);
  }
}

function parseScript(raw: unknown, index: number, issues: string[]): ShortScript {
  const path = `scripts[${index}]`;
  if (!isRecord(raw)) {
    issues.push(`${path}: オブジェクトが必要です`);
    return EMPTY_SCRIPT;
  }

  const id = readString(raw, 'id', path, issues);
  if (id.length > 0 && !ID_PATTERN.test(id)) {
    issues.push(`${path}.id: 小文字英数字とハイフンのみ使用できます (${id})`);
  }

  const hookTypeRaw = raw['hookType'];
  const hookType = HOOK_TYPES.find((candidate) => candidate === hookTypeRaw);
  if (hookType === undefined) {
    issues.push(`${path}.hookType: ${HOOK_TYPES.join(' | ')} のいずれかが必要です`);
  }

  const bodyRaw = raw['script'];
  const bodyPath = `${path}.script`;
  const body = isRecord(bodyRaw) ? bodyRaw : {};
  if (!isRecord(bodyRaw)) issues.push(`${bodyPath}: オブジェクトが必要です`);

  const script: ShortScript = {
    id,
    title: readString(raw, 'title', path, issues),
    hookType: hookType ?? '損失回避',
    telopFirstFrame: readString(raw, 'telopFirstFrame', path, issues),
    script: {
      hook: readString(body, 'hook', bodyPath, issues),
      problem: readString(body, 'problem', bodyPath, issues),
      solution: readString(body, 'solution', bodyPath, issues),
      cta: readString(body, 'cta', bodyPath, issues),
    },
    visual: parseVisual(raw['visual'], `${path}.visual`, issues),
    disclaimer: readString(raw, 'disclaimer', path, issues),
    ctaLabel: readString(raw, 'ctaLabel', path, issues),
    hashtags: readStringArray(raw, 'hashtags', path, issues),
  };

  checkCompliance(script, path, issues);
  return script;
}

const EMPTY_SCRIPT: ShortScript = {
  id: '',
  title: '',
  hookType: '損失回避',
  telopFirstFrame: '',
  script: { hook: '', problem: '', solution: '', cta: '' },
  visual: { kind: 'bullets', items: [], caption: '' },
  disclaimer: '',
  ctaLabel: '',
  hashtags: [],
};

/** JSON.parse 済みの値を検証済みの台本配列に変換する。失敗時は全件の問題を投げる。 */
export function parseScriptSet(raw: unknown): readonly ShortScript[] {
  const issues: string[] = [];
  if (!Array.isArray(raw)) {
    throw new ScriptValidationError(['ルートは台本の配列である必要があります']);
  }
  const scripts = raw.map((entry, index) => parseScript(entry, index, issues));

  const seen = new Set<string>();
  for (const script of scripts) {
    if (script.id.length === 0) continue;
    if (seen.has(script.id)) issues.push(`id が重複しています: ${script.id}`);
    seen.add(script.id);
  }

  if (issues.length > 0) throw new ScriptValidationError(issues);
  return scripts;
}

export function isHookType(value: string): value is HookType {
  return HOOK_TYPES.some((candidate) => candidate === value);
}
