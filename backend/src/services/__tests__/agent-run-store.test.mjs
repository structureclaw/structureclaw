import { describe, expect, test, beforeAll } from '@jest/globals';
import { AgentRunStoreService } from '../../../dist/services/agent-run-store.js';
import { prisma } from '../../../dist/utils/database.js';

describe('agent run store service', () => {
  beforeAll(async () => {
    // Ensure the table exists (Jest runs db:generate + build but not db:push)
    const tables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_pipeline_runs'`;
    if (tables.length === 0) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE agent_pipeline_runs (
          id TEXT NOT NULL PRIMARY KEY,
          projectId TEXT,
          conversationId TEXT,
          targetArtifact TEXT NOT NULL,
          toolId TEXT NOT NULL,
          providerSkillId TEXT,
          status TEXT NOT NULL,
          inputFingerprint TEXT NOT NULL,
          diagnostics TEXT,
          startedAt DATETIME,
          finishedAt DATETIME,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
  });

  test('persists queued and completed run lifecycle records independently of project pipeline state', async () => {
    const store = new AgentRunStoreService();
    const queued = await store.createRun({
      targetArtifact: 'analysisRaw',
      toolId: 'run_analysis',
      status: 'queued',
      inputFingerprint: 'fp-1',
    });

    const completed = await store.updateRun(queued.runId, {
      status: 'succeeded',
      finishedAt: new Date('2026-04-13T12:00:00Z'),
    });

    expect(completed.status).toBe('succeeded');
  });
});
