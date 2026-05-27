import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

describe('agent tool call limit defaults', () => {
  test('defaults maxToolCallsPerTurn to 200 across backend and frontend settings', () => {
    const configSource = fs.readFileSync(path.join(ROOT, 'src/config/index.ts'), 'utf8');
    const adminSettingsSource = fs.readFileSync(path.join(ROOT, 'src/api/admin-settings.ts'), 'utf8');
    const graphSource = fs.readFileSync(path.join(ROOT, 'src/agent-langgraph/graph.ts'), 'utf8');
    const frontendSettingsSource = fs.readFileSync(path.join(ROOT, '../frontend/src/components/settings/general-settings-panel.tsx'), 'utf8');

    expect(configSource).toContain('maxToolCallsPerTurn: 200');
    expect(adminSettingsSource).toContain('agentMaxToolCallsPerTurn: 200');
    expect(graphSource).toContain('DEFAULT_MAX_TOOL_CALLS_PER_TURN = 200');
    expect(frontendSettingsSource).toContain('maxToolCallsPerTurn: 200');
  });
});
