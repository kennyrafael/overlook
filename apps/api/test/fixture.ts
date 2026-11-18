import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface Fixture {
  base: string;
  root: string;
  dataDir: string;
  claudeDir: string;
  alpha: string;
  beta: string;
  plan: string;
}

export const PLAN = `# Alpha

## Phase 1
- [x] scaffold
- [ ] parser
  wrapped line

## Phase 2
- [ ] deploy
`;

const day = () => new Date().toISOString().slice(0, 10);

/**
 * Builds an isolated world: two projects under a root folder, a Claude history
 * folder with one session for "alpha", and an empty data dir. Nothing outside
 * the temp folder is read or written.
 */
export function createFixture(): Fixture {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'cpd-e2e-')));
  const root = join(base, 'projects');
  const alpha = join(root, 'alpha');
  const beta = join(root, 'beta');
  const dataDir = join(base, 'data');
  const claudeDir = join(base, 'claude');
  for (const d of [alpha, beta, dataDir]) mkdirSync(d, { recursive: true });

  const plan = join(alpha, 'PLAN.md');
  writeFileSync(plan, PLAN);
  writeFileSync(join(beta, 'CLAUDE.md'), '# Beta\n\nNotes only, no checklists.\n');

  // Claude history: folder name = path with non-alphanumerics replaced by '-'.
  const sessionDir = join(claudeDir, 'projects', alpha.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(sessionDir, { recursive: true });
  const ts = (h: number) => `${day()}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 } };
  const lines = [
    { type: 'user', timestamp: ts(9), sessionId: 's1', cwd: alpha, message: { role: 'user', content: 'build the parser' } },
    // Same message id twice (one line per content block): counted once.
    { type: 'assistant', timestamp: ts(9), sessionId: 's1', cwd: alpha, message: { id: 'm1', model: 'claude-opus-5-5', usage } },
    { type: 'assistant', timestamp: ts(9), sessionId: 's1', cwd: alpha, message: { id: 'm1', model: 'claude-opus-5-5', usage } },
    { type: 'user', timestamp: ts(10), sessionId: 's1', cwd: alpha, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'assistant', timestamp: ts(10), sessionId: 's1', cwd: alpha, message: { id: 'm2', model: 'claude-haiku-5-5', usage: { input_tokens: 100, output_tokens: 100 } } },
    { type: 'custom-title', customTitle: 'Parser work', sessionId: 's1' },
  ];
  writeFileSync(join(sessionDir, 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  return { base, root, dataDir, claudeDir, alpha, beta, plan };
}
