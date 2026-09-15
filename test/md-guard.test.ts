import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decide, isAuditorSession, sessionKey, type AuditorConfig, type HookInput } from '../scripts/md-guard.ts';

const CONFIG: AuditorConfig = {
  auditorSessionIds: ['session_01AUDITOR'],
  requestDir: '.claude/md-requests',
};
const OTHER_SESSION = { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01OTHER' } as const;
const AUDITOR_SESSION = { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01AUDITOR' } as const;

const write = (file_path: string): HookInput => ({ tool_name: 'Write', tool_input: { file_path } });
const bash = (command: string): HookInput => ({ tool_name: 'Bash', tool_input: { command } });

test('session key ignores the id prefix so cse_ and session_ forms match', () => {
  assert.equal(sessionKey('cse_01ABC'), '01ABC');
  assert.equal(sessionKey('session_01ABC'), '01ABC');
  assert.equal(isAuditorSession(AUDITOR_SESSION, CONFIG), true);
  assert.equal(isAuditorSession(OTHER_SESSION, CONFIG), false);
  assert.equal(isAuditorSession({}, CONFIG), false);
  assert.equal(isAuditorSession({ MD_AUDITOR: '1' }, CONFIG), true);
});

test('Write/Edit/MultiEdit to markdown is denied outside the auditor session', () => {
  for (const tool of ['Write', 'Edit', 'MultiEdit'] as const) {
    const decision = decide({ tool_name: tool, tool_input: { file_path: '/repo/docs/README.md' } }, OTHER_SESSION, CONFIG);
    assert.equal(decision.allow, false, tool);
    if (!decision.allow) assert.match(decision.reason, /md-requests/);
  }
  assert.equal(decide(write('/repo/CLAUDE.md'), OTHER_SESSION, CONFIG).allow, false);
  assert.equal(decide(write('/repo/notes.MDX'), OTHER_SESSION, CONFIG).allow, false);
});

test('the auditor session may write markdown', () => {
  assert.equal(decide(write('/repo/docs/README.md'), AUDITOR_SESSION, CONFIG).allow, true);
});

test('non-markdown writes are always allowed', () => {
  assert.equal(decide(write('/repo/src/main.ts'), OTHER_SESSION, CONFIG).allow, true);
  assert.equal(decide(write('/repo/md/index.ts'), OTHER_SESSION, CONFIG).allow, true);
  assert.equal(decide(write('/repo/.claude/md-auditor.json'), OTHER_SESSION, CONFIG).allow, true);
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/repo/README.md' } }, OTHER_SESSION, CONFIG).allow, true);
});

test('Bash: read-only access to markdown is allowed', () => {
  for (const command of [
    'cat README.md',
    'head -20 docs/guide.md | grep -n TODO',
    'find . -name "*.md" -not -path "./node_modules/*"',
    'git diff -- README.md && git log --oneline -- docs/',
    'ls docs/*.md; wc -l README.md',
    'LANG=C grep -rn "foo" --include="*.md" .',
    'rg "pattern" -g "*.md" > /dev/null 2>&1',
  ]) {
    assert.equal(decide(bash(command), OTHER_SESSION, CONFIG).allow, true, command);
  }
});

test('Bash: anything that can mutate markdown is denied', () => {
  for (const command of [
    'echo "# Title" > README.md',
    'cat notes.txt >> docs/guide.md',
    'sed -i "s/a/b/" README.md',
    'tee README.md < input.txt',
    'mv old.md new.md',
    'rm docs/stale.md',
    'touch docs/new.md',
    'git mv a.md b.md',
    'git checkout -- README.md',
    'cat a.txt | tee docs/out.md',
    'node -e "require(\'fs\').writeFileSync(\'x.md\', \'\')"',
    'cat README.md && rm README.md',
    "awk '{print > \"out.md\"}' in.txt",
    'cp -r docs /tmp/backup && cp /tmp/x.md docs/',
    "cat > CLAUDE.md <<'EOF'\n# hi\nEOF",
  ]) {
    assert.equal(decide(bash(command), OTHER_SESSION, CONFIG).allow, false, command);
  }
});

test('Bash: a heredoc body that merely mentions markdown does not block a non-markdown target', () => {
  const command = "cat > src/paths.ts <<'EOF'\nexport const README = 'README.md';\nEOF\nnpm test";
  assert.equal(decide(bash(command), OTHER_SESSION, CONFIG).allow, true);
});

test('Bash: commands that never mention markdown are allowed', () => {
  assert.equal(decide(bash('npm test && git push -u origin feature'), OTHER_SESSION, CONFIG).allow, true);
  assert.equal(decide(bash('rm -rf dist'), OTHER_SESSION, CONFIG).allow, true);
});

test('GitHub MCP file writes to markdown are denied', () => {
  const create: HookInput = { tool_name: 'mcp__github__create_or_update_file', tool_input: { path: 'docs/a.md', content: '' } };
  const del: HookInput = { tool_name: 'mcp__github__delete_file', tool_input: { path: 'README.md' } };
  const push: HookInput = {
    tool_name: 'mcp__github__push_files',
    tool_input: { files: [{ path: 'src/a.ts', content: '' }, { path: 'docs/b.md', content: '' }] },
  };
  const pushClean: HookInput = { tool_name: 'mcp__github__push_files', tool_input: { files: [{ path: 'src/a.ts', content: '' }] } };
  assert.equal(decide(create, OTHER_SESSION, CONFIG).allow, false);
  assert.equal(decide(del, OTHER_SESSION, CONFIG).allow, false);
  assert.equal(decide(push, OTHER_SESSION, CONFIG).allow, false);
  assert.equal(decide(pushClean, OTHER_SESSION, CONFIG).allow, true);
  assert.equal(decide(push, AUDITOR_SESSION, CONFIG).allow, true);
});

test('an empty allowlist fails closed: nobody may write markdown', () => {
  const empty: AuditorConfig = { auditorSessionIds: [], requestDir: '.claude/md-requests' };
  assert.equal(decide(write('/repo/README.md'), AUDITOR_SESSION, empty).allow, false);
});
