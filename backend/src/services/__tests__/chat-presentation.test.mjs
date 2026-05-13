import Fastify from 'fastify';
import { beforeAll, describe, expect, test } from '@jest/globals';
import {
  createEmptyAssistantPresentation,
  reducePresentationEvent,
} from '../../../dist/services/chat-presentation.js';
import { prisma } from '../../../dist/utils/database.js';

describe('chat presentation reducer', () => {
  beforeAll(async () => {
    const conversationTables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'`;
    if (conversationTables.length === 0) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE conversations (
          id TEXT NOT NULL PRIMARY KEY,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          modelSnapshot TEXT,
          resultSnapshot TEXT,
          latestResult TEXT
        )
      `);
    }

    const messageTables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='messages'`;
    if (messageTables.length === 0) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE messages (
          id TEXT NOT NULL PRIMARY KEY,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          name TEXT,
          toolCallId TEXT,
          toolCalls TEXT,
          metadata TEXT,
          tokenCount INTEGER,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          conversationId TEXT NOT NULL,
          FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
        )
      `);
    }
  });

  test('initializes and upserts steps + artifacts', () => {
    let state = createEmptyAssistantPresentation({
      traceId: 'trace-1',
      mode: 'execution',
      startedAt: '2026-04-19T10:00:00.000Z',
    });

    state = reducePresentationEvent(state, {
      type: 'phase_upsert',
      phase: {
        phaseId: 'phase:modeling',
        phase: 'modeling',
        title: '建模阶段',
        status: 'running',
        steps: [],
      },
    });

    state = reducePresentationEvent(state, {
      type: 'step_upsert',
      phaseId: 'phase:modeling',
      step: {
        id: 'step:build_model:2026-04-19T10:00:00.010Z',
        phase: 'modeling',
        status: 'running',
        tool: 'build_model',
        skillId: 'frame',
        title: '生成结构模型',
        reason: 'draft model',
        startedAt: '2026-04-19T10:00:00.010Z',
      },
    });

    state = reducePresentationEvent(state, {
      type: 'step_upsert',
      phaseId: 'phase:modeling',
      step: {
        id: 'step:build_model:2026-04-19T10:00:00.010Z',
        phase: 'modeling',
        status: 'done',
        tool: 'build_model',
        skillId: 'frame',
        title: '结构模型已生成',
        reason: 'draft model',
        output: { model: { schema_version: '1.0.0' } },
        startedAt: '2026-04-19T10:00:00.010Z',
        completedAt: '2026-04-19T10:00:00.030Z',
        durationMs: 20,
      },
    });

    state = reducePresentationEvent(state, {
      type: 'artifact_upsert',
      artifact: {
        artifact: 'model',
        status: 'available',
        title: '结构模型',
        previewable: true,
        snapshotKey: 'modelSnapshot',
      },
    });

    state = reducePresentationEvent(state, {
      type: 'summary_replace',
      summaryText: '模型已生成，可继续分析。',
    });

    state = reducePresentationEvent(state, {
      type: 'presentation_complete',
      completedAt: '2026-04-19T10:00:00.050Z',
    });

    expect(state.summaryText).toBe('模型已生成，可继续分析。');
    expect(state.phases).toHaveLength(1);
    expect(state.phases[0].phaseId).toBe('phase:modeling');
    expect(state.phases[0].steps).toHaveLength(1);
    expect(state.phases[0].steps[0].tool).toBe('build_model');
    expect(state.phases[0].steps[0].skillId).toBe('frame');
    expect(state.phases[0].steps[0].status).toBe('done');
    expect(state.artifacts[0].artifact).toBe('model');
    expect(state.status).toBe('done');
  });

  test('step status flows from running to done', () => {
    let state = createEmptyAssistantPresentation({
      traceId: 'trace-2',
      mode: 'execution',
    });

    state = reducePresentationEvent(state, {
      type: 'phase_upsert',
      phase: {
        phaseId: 'phase:analysis',
        phase: 'analysis',
        title: 'Analysis',
        status: 'running',
        steps: [],
      },
    });

    // Start
    state = reducePresentationEvent(state, {
      type: 'step_upsert',
      phaseId: 'phase:analysis',
      step: {
        id: 'step:run_analysis:2026-04-19T10:00:01.000Z',
        phase: 'analysis',
        status: 'running',
        tool: 'run_analysis',
        title: 'Running analysis',
        startedAt: '2026-04-19T10:00:01.000Z',
      },
    });
    expect(state.phases[0].steps[0].status).toBe('running');

    // Complete
    state = reducePresentationEvent(state, {
      type: 'step_upsert',
      phaseId: 'phase:analysis',
      step: {
        id: 'step:run_analysis:2026-04-19T10:00:01.000Z',
        phase: 'analysis',
        status: 'done',
        tool: 'run_analysis',
        title: 'Analysis completed',
        output: { displacements: [0.1, 0.2] },
        startedAt: '2026-04-19T10:00:01.000Z',
        completedAt: '2026-04-19T10:00:05.000Z',
        durationMs: 4000,
      },
    });
    expect(state.phases[0].steps[0].status).toBe('done');
    expect(state.phases[0].steps).toHaveLength(1);
    expect(state.phases[0].steps[0].output).toEqual({ displacements: [0.1, 0.2] });
  });

  test('stream persistence stores presentation in assistant message metadata', async () => {
    const { LangGraphAgentService } = await import('../../../dist/agent-langgraph/agent-service.js');
    const { chatRoutes } = await import('../../../dist/api/chat.js');
    const originalRunStream = LangGraphAgentService.prototype.runStream;
    const conversationId = `conv-presentation-${Date.now()}`;
    const traceId = 'trace-presentation-001';

    await prisma.conversation.create({
      data: {
        id: conversationId,
        title: 'Presentation test',
        type: 'general',
      },
    });

    LangGraphAgentService.prototype.runStream = async function* mockRunStream() {
      yield {
        type: 'start',
        content: {
          traceId,
          conversationId,
          startedAt: '2026-04-19T10:00:00.000Z',
        },
      };
      yield {
        type: 'presentation_init',
        presentation: createEmptyAssistantPresentation({
          traceId,
          mode: 'execution',
          startedAt: '2026-04-19T10:00:00.000Z',
        }),
      };
      yield {
        type: 'phase_upsert',
        phase: {
          phaseId: 'phase:modeling',
          phase: 'modeling',
          title: '建模阶段',
          status: 'running',
          steps: [],
        },
      };
      yield {
        type: 'step_upsert',
        phaseId: 'phase:modeling',
        step: {
          id: 'step:build_model:2026-04-19T10:00:00.015Z',
          phase: 'modeling',
          status: 'running',
          tool: 'build_model',
          skillId: 'frame',
          title: '生成结构模型',
          startedAt: '2026-04-19T10:00:00.015Z',
        },
      };
      yield {
        type: 'summary_replace',
        summaryText: 'Please provide the span and support conditions.',
      };
      yield {
        type: 'result',
        content: {
          traceId,
          conversationId,
          startedAt: '2026-04-19T10:00:00.000Z',
          completedAt: '2026-04-19T10:00:00.050Z',
          durationMs: 50,
          success: true,
          orchestrationMode: 'llm-planned',
          needsModelInput: true,
          plan: [],
          routing: {
            selectedSkillIds: ['frame'],
            activatedSkillIds: ['frame'],
            structuralSkillId: 'frame',
          },
          toolCalls: [
            {
              tool: 'build_model',
              status: 'success',
              startedAt: '2026-04-19T10:00:00.015Z',
              completedAt: '2026-04-19T10:00:00.030Z',
              durationMs: 15,
              output: {
                model: { schema_version: '1.0.0' },
              },
            },
          ],
          model: {
            schema_version: '1.0.0',
          },
          interaction: {
            state: 'confirming',
            stage: 'model',
            turnId: 'turn-clarify',
            missingCritical: ['span', 'support conditions'],
            missingOptional: [],
          },
          clarification: {
            missingFields: ['span', 'support conditions'],
            question: 'Please provide the span and support conditions.',
          },
          response: 'Please provide the span and support conditions.',
        },
      };
      yield {
        type: 'presentation_complete',
        completedAt: '2026-04-19T10:00:00.050Z',
      };
      yield { type: 'done' };
    };

    const app = Fastify();
    try {
      await app.register(chatRoutes, { prefix: '/api/v1/chat' });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        payload: {
          message: '帮我建模',
          conversationId,
          traceId,
        },
      });

      expect(response.statusCode).toBe(200);

      const messages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
      });
      const assistantMessage = messages.find((message) => message.role === 'assistant');

      expect(assistantMessage).toBeTruthy();
      expect(assistantMessage?.metadata?.presentation).toBeDefined();
      expect(assistantMessage?.metadata?.presentation?.version).toBe(3);
      expect(assistantMessage?.metadata?.presentation?.summaryText).toBe('Please provide the span and support conditions.');
      expect(Array.isArray(assistantMessage?.metadata?.presentation?.phases)).toBe(true);
      expect(assistantMessage?.metadata?.presentation?.phases?.some((phase) => phase.phase === 'modeling')).toBe(true);
      const modelingPhase = assistantMessage?.metadata?.presentation?.phases?.find((phase) => phase.phase === 'modeling');
      expect(modelingPhase).toBeTruthy();
      expect(modelingPhase?.steps?.some((step) => step.tool === 'build_model')).toBe(true);
      expect(modelingPhase?.steps?.some((step) => step.skillId === 'frame')).toBe(true);
    } finally {
      LangGraphAgentService.prototype.runStream = originalRunStream;
      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.conversation.deleteMany({ where: { id: conversationId } });
      await app.close();
    }
  }, 30000);
});
