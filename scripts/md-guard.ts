/**
 * Claude Code PreToolUse hook: Markdown への書き込みを「md 監査役」セッション以外で拒否する。
 *
 * 判定対象:
 *   - Write / Edit / MultiEdit / NotebookEdit  … file_path / notebook_path が *.md
 *   - Bash                                    … コマンド文字列が *.md に触れ、かつ read-only と判定できない
 *   - mcp__github__{create_or_update_file,delete_file,push_files} … path が *.md
 *
 * 免除条件 (どちらか):
 *   - 環境変数 CLAUDE_CODE_REMOTE_SESSION_ID の ID 部分が .claude/md-auditor.json の auditorSessionIds に含まれる
 *   - 環境変数 MD_AUDITOR=1 (ローカルで人間が `MD_AUDITOR=1 claude` と起動した場合のみ)
 *
 * 設定ファイルが読めない場合は fail-closed (全セッションで md 書き込み拒否)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type HookInput = {
  readonly tool_name: string;
  readonly tool_input: Readonly<Record<string, unknown>>;
};

export type AuditorConfig = {
  readonly auditorSessionIds: readonly string[];
  readonly requestDir: string;
};

export type Decision = { readonly allow: true } | { readonly allow: false; readonly reason: string };

export type GuardEnv = Readonly<Record<string, string | undefined>>;

const CONFIG_RELATIVE_PATH = '.claude/md-auditor.json';
const MARKDOWN_PATH_RE = /\.(?:md|markdown|mdx)$/i;
const MARKDOWN_MENTION_RE = /\.(?:md|markdown|mdx)\b/i;

/** 先頭語がこれらなら、その区間は読み取り専用とみなす。 */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'ls', 'wc',
  'diff', 'stat', 'file', 'md5sum', 'sha1sum', 'sha256sum', 'sort', 'uniq', 'cut', 'tr', 'awk',
  'echo', 'printf', 'test', '[', 'true', 'cd', 'pwd', 'export', 'env', 'time', 'realpath', 'dirname', 'basename',
]);
const READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'diff', 'log', 'show', 'status', 'grep', 'ls-files', 'blame', 'cat-file', 'rev-parse', 'branch', 'fetch',
]);

const isMarkdownPath = (value: unknown): value is string =>
  typeof value === 'string' && MARKDOWN_PATH_RE.test(value.trim());

/** `2>&1` や `>/dev/null` は無害。それ以外の `>` / `>>` で *.md へ向くものを検出する。 */
const redirectsIntoMarkdown = (command: string): boolean =>
  /(?:^|[^&\d])>{1,2}\s*["']?[^\s"'|;&]*\.(?:md|markdown|mdx)\b/i.test(command);

const splitSegments = (command: string): readonly string[] =>
  command
    .split(/\|\|?|&&|;|\n|\$\(|`/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const firstWord = (segment: string): readonly [string, string | undefined] => {
  const words = segment.replace(/^\(+/, '').split(/\s+/);
  const head = words[0] ?? '';
  return [head.replace(/^.*\//, ''), words[1]];
};

const isReadOnlySegment = (segment: string): boolean => {
  const [command, sub] = firstWord(segment);
  if (command === 'git') return sub !== undefined && READ_ONLY_GIT_SUBCOMMANDS.has(sub);
  if (/^[A-Z_][A-Z0-9_]*=/.test(command)) return isReadOnlySegment(segment.replace(/^\S+\s*/, ''));
  return READ_ONLY_COMMANDS.has(command);
};

/**
 * heredoc 本文 (`<<'EOF' … EOF`) は書き込み先を決めないので判定から除外する。
 * 書き込み先は常に heredoc 開始行 (`cat > x.md <<'EOF'`) に現れる。
 */
const stripHeredocBodies = (command: string): string => {
  const lines = command.split('\n');
  const kept: string[] = [];
  let terminator: string | undefined;
  for (const line of lines) {
    if (terminator !== undefined) {
      if (line.trim() === terminator) terminator = undefined;
      continue;
    }
    kept.push(line);
    const match = /<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(line);
    if (match) terminator = match[1] ?? match[2] ?? match[3];
  }
  return kept.join('\n');
};

const bashTouchesMarkdown = (rawCommand: string): boolean => {
  const command = stripHeredocBodies(rawCommand);
  if (!MARKDOWN_MENTION_RE.test(command)) return false;
  if (redirectsIntoMarkdown(command)) return true;
  return !splitSegments(command).every(isReadOnlySegment);
};

const markdownTargets = (input: HookInput): readonly string[] => {
  const { tool_name: tool, tool_input: args } = input;
  switch (tool) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return isMarkdownPath(args['file_path']) ? [args['file_path']] : [];
    case 'NotebookEdit':
      return isMarkdownPath(args['notebook_path']) ? [args['notebook_path']] : [];
    case 'Bash': {
      const command = args['command'];
      return typeof command === 'string' && bashTouchesMarkdown(command) ? [command] : [];
    }
    case 'mcp__github__create_or_update_file':
    case 'mcp__github__delete_file':
      return isMarkdownPath(args['path']) ? [args['path']] : [];
    case 'mcp__github__push_files': {
      const files = args['files'];
      if (!Array.isArray(files)) return [];
      return files
        .map((entry: unknown) => (typeof entry === 'object' && entry !== null ? (entry as { path?: unknown }).path : undefined))
        .filter(isMarkdownPath);
    }
    default:
      return [];
  }
};

/** `session_01ABC` / `cse_01ABC` のようなプレフィックス差を吸収して ID 部分だけ比較する。 */
export const sessionKey = (id: string): string => id.trim().replace(/^[a-z]+_/i, '');

export const isAuditorSession = (env: GuardEnv, config: AuditorConfig): boolean => {
  if (env['MD_AUDITOR'] === '1') return true;
  const current = env['CLAUDE_CODE_REMOTE_SESSION_ID'];
  if (!current) return false;
  const key = sessionKey(current);
  return config.auditorSessionIds.some((allowed) => sessionKey(allowed) === key);
};

export const decide = (input: HookInput, env: GuardEnv, config: AuditorConfig): Decision => {
  const targets = markdownTargets(input);
  if (targets.length === 0 || isAuditorSession(env, config)) return { allow: true };
  return {
    allow: false,
    reason:
      `[md-guard] Markdown への書き込みは md 監査役セッションのみ許可されています (対象: ${targets.join(', ')})。` +
      ` 変更が必要なら ${config.requestDir}/YYYYMMDD-<slug>.txt に依頼内容 (対象ファイル / 変更内容 / 理由) を書いてください。` +
      ' 監査役が日次で処理します。このガードを迂回しないでください。',
  };
};

export const loadConfig = (projectDir: string): AuditorConfig => {
  const raw: unknown = JSON.parse(readFileSync(resolve(projectDir, CONFIG_RELATIVE_PATH), 'utf8'));
  if (typeof raw !== 'object' || raw === null) throw new Error(`${CONFIG_RELATIVE_PATH}: object expected`);
  const record = raw as { auditorSessionIds?: unknown; requestDir?: unknown };
  const ids = Array.isArray(record.auditorSessionIds) ? record.auditorSessionIds : [];
  if (!ids.every((id): id is string => typeof id === 'string')) {
    throw new Error(`${CONFIG_RELATIVE_PATH}: auditorSessionIds must be string[]`);
  }
  return {
    auditorSessionIds: ids,
    requestDir: typeof record.requestDir === 'string' ? record.requestDir : '.claude/md-requests',
  };
};

const FALLBACK_CONFIG: AuditorConfig = { auditorSessionIds: [], requestDir: '.claude/md-requests' };

const deny = (reason: string): void => {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    })}\n`,
  );
};

export const main = (): void => {
  const raw = readFileSync(0, 'utf8');
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  let config = FALLBACK_CONFIG;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    process.stderr.write(`[md-guard] config unreadable, failing closed: ${String(error)}\n`);
  }
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    if (MARKDOWN_MENTION_RE.test(raw)) deny('[md-guard] hook input could not be parsed; Markdown write denied (fail-closed).');
    return;
  }
  const decision = decide(input, process.env, config);
  if (!decision.allow) deny(decision.reason);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
