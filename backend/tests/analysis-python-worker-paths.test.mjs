import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
const workerPath = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'runtime',
  'worker.py',
);

describe('analysis python worker import paths', () => {
  test('should include structure protocol and sibling skill roots from the actual src tree', () => {
    const worker = fs.readFileSync(workerPath, 'utf8');

    expect(worker).toContain('AGENT_SKILLS_ROOT = CURRENT_DIR.parents[1]');
    expect(worker).toContain('SRC_ROOT = CURRENT_DIR.parents[2]');
    expect(worker).toContain('SRC_ROOT / "skill-shared" / "python"');
    expect(worker).toContain('AGENT_SKILLS_ROOT / "data-input"');
    expect(worker).toContain('AGENT_SKILLS_ROOT / "code-check"');
    expect(worker).toContain('AGENT_SKILLS_ROOT / "material"');
    expect(worker).not.toContain('CURRENT_DIR.parents[3] / "skill-shared" / "python"');
    expect(worker).not.toContain('AGENT_SKILLS_ROOT = CURRENT_DIR.parents[2]');
  });
});
