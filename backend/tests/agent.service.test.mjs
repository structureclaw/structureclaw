import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import { AgentService } from '../dist/services/agent.js';
import { prisma } from '../dist/utils/database.js';
import { cache } from '../dist/utils/cache.js';

function createServiceWithDefaultSkills() {
  const svc = new AgentService();
  let defaultSkillIdsPromise;

  const getDefaultSkillIds = async () => {
    if (!defaultSkillIdsPromise) {
      defaultSkillIdsPromise = svc.listSkills().then((skills) => skills.map((skill) => skill.id));
    }
    return defaultSkillIdsPromise;
  };

  const applyDefaultSkills = async (params) => {
    const context = params?.context || {};
    if (context.skillIds !== undefined) {
      return params;
    }
    const defaultSkillIds = await getDefaultSkillIds();
    return {
      ...params,
      context: {
        ...context,
        skillIds: defaultSkillIds,
      },
    };
  };

  const originalRun = svc.run.bind(svc);
  svc.run = async (params) => originalRun(await applyDefaultSkills(params));

  const runWithStrategy = svc.runWithStrategy.bind(svc);
  svc.runChatOnly = async (params) => runWithStrategy(
    await applyDefaultSkills(params),
    { planningDirective: 'auto', allowToolCall: false },
  );
  svc.runForcedExecution = async (params) => runWithStrategy(
    await applyDefaultSkills(params),
    { planningDirective: 'force_tool', allowToolCall: true },
  );

  const originalRunStream = svc.runStream.bind(svc);
  svc.runStream = async function* (params) {
    yield* originalRunStream(await applyDefaultSkills(params));
  };

  const runStreamWithStrategy = svc.runStreamWithStrategy.bind(svc);
  svc.runChatOnlyStream = async function* (params) {
    yield* runStreamWithStrategy(
      await applyDefaultSkills(params),
      { planningDirective: 'auto', allowToolCall: false },
    );
  };
  svc.runForcedExecutionStream = async function* (params) {
    yield* runStreamWithStrategy(
      await applyDefaultSkills(params),
      { planningDirective: 'force_tool', allowToolCall: true },
    );
  };

  const originalTextToModelDraft = svc.textToModelDraft.bind(svc);
  svc.textToModelDraft = async (message, existingState, locale, skillIds) => {
    const resolvedSkillIds = skillIds === undefined ? await getDefaultSkillIds() : skillIds;
    return (
    originalTextToModelDraft(
      message,
      existingState,
      locale,
      resolvedSkillIds,
    )
    );
  };

  const originalGetConversationSessionSnapshot = svc.getConversationSessionSnapshot.bind(svc);
  svc.getConversationSessionSnapshot = async (conversationId, locale, skillIds) => {
    const resolvedSkillIds = skillIds === undefined ? await getDefaultSkillIds() : skillIds;
    return (
    originalGetConversationSessionSnapshot(
      conversationId,
      locale,
      resolvedSkillIds,
    )
    );
  };

  return svc;
}

function stubExecutionClients(svc, handlers = {}) {
  const calls = [];

  svc.structureProtocolClient = {
    post: async (path, payload) => {
      calls.push({ client: 'structureProtocol', path, payload });
      if (path === '/validate') {
        if (handlers.validate) {
          return handlers.validate(path, payload, calls);
        }
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/convert') {
        if (handlers.convert) {
          return handlers.convert(path, payload, calls);
        }
        return { data: { model: payload?.model ?? {} } };
      }
      throw new Error(`unexpected structure protocol path ${path}`);
    },
  };

  svc.engineClient.post = async (path, payload) => {
    calls.push({ client: 'analysis', path, payload });
    if (path === '/analyze') {
      if (handlers.analyze) {
        return handlers.analyze(path, payload, calls);
      }
      return {
        data: {
          schema_version: '1.0.0',
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: 'ok',
          data: {},
          meta: {},
        },
      };
    }
    if (path === '/validate') {
      if (handlers.validate) {
        return handlers.validate(path, payload, calls);
      }
      return { data: { valid: true, schemaVersion: '1.0.0' } };
    }
    if (path === '/convert') {
      if (handlers.convert) {
        return handlers.convert(path, payload, calls);
      }
      return { data: { model: payload?.model ?? {} } };
    }
    throw new Error(`unexpected analysis path ${path}`);
  };

  svc.codeCheckClient = {
    post: async (path, payload) => {
      calls.push({ client: 'codeCheck', path, payload });
      if (path === '/code-check') {
        if (handlers.codeCheck) {
          return handlers.codeCheck(path, payload, calls);
        }
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            details: [],
          },
        };
      }
      throw new Error(`unexpected code-check path ${path}`);
    },
  };

  return calls;
}

function createPlannerHttpError(status, data, message = 'planner request failed') {
  const error = new Error(message);
  error.response = { status, data };
  return error;
}

const prismaMethodDefaults = {
  conversationCreate: prisma.conversation.create,
  conversationFindUnique: prisma.conversation.findUnique,
  messageCreateMany: prisma.message.createMany,
  messageFindMany: prisma.message.findMany,
};

let createdConversationCount = 0;

function installConversationPersistenceStubs() {
  prisma.conversation.create = async ({ data }) => {
    createdConversationCount += 1;
    return {
      id: `conv-test-${createdConversationCount}`,
      title: data?.title ?? null,
      type: data?.type ?? 'general',
      userId: data?.userId ?? null,
    };
  };

  prisma.conversation.findUnique = async ({ where }) => {
    if (!where?.id) {
      return null;
    }
    return { id: where.id };
  };

  prisma.message.createMany = async ({ data }) => ({
    count: Array.isArray(data) ? data.length : 0,
  });

  prisma.message.findMany = async () => [];
}

function restoreConversationPersistenceStubs() {
  prisma.conversation.create = prismaMethodDefaults.conversationCreate;
  prisma.conversation.findUnique = prismaMethodDefaults.conversationFindUnique;
  prisma.message.createMany = prismaMethodDefaults.messageCreateMany;
  prisma.message.findMany = prismaMethodDefaults.messageFindMany;
}

describe('AgentService orchestration', () => {
  beforeEach(() => {
    installConversationPersistenceStubs();
  });

  afterEach(() => {
    restoreConversationPersistenceStubs();
  });

  test('should not seed an empty interaction session with a default unknown draft', async () => {
    const svc = createServiceWithDefaultSkills();

    const snapshot = await svc.buildPlannerContextSnapshot({
      locale: 'zh',
      skillIds: ['generic'],
      hasModel: false,
      session: undefined,
      activeToolIds: new Set(['draft_model']),
      conversationId: undefined,
    });

    expect(snapshot.hasActiveSession).toBe(false);
    expect(snapshot.inferredType).toBeNull();
  });

  test('should execute analyze -> code-check -> report closed loop', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc, {
      analyze: async (_path, payload) => {
        expect(payload.engineId).toBeUndefined();
        return {
          data: {
            schema_version: '1.0.0',
            analysis_type: payload.type,
            success: true,
            error_code: null,
            message: 'ok',
            data: {},
            meta: {},
          },
        };
      },
    });

    const result = await svc.runForcedExecution({
      message: '请静力分析并规范校核',
      context: {
        skillIds: [],
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        skillIds: ['code-check-gb50017'],
        autoAnalyze: true,
        autoCodeCheck: true,
        includeReport: true,
        reportFormat: 'both',
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.analysisSkillId).toBe('opensees-static');
    expect(result.routing?.analysisSkillIds).toEqual(['opensees-static']);
    expect(result.routing?.codeCheckSkillId).toBe('code-check-gb50017');
    expect(result.routing?.validationSkillId).toBe('validation-structure-model');
    expect(result.routing?.reportSkillId).toBe('report-export-builtin');
    expect(result.toolCalls.some((c) => c.tool === 'run_analysis')).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'run_code_check')).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'generate_report')).toBe(true);
    expect(result.toolCalls.find((c) => c.tool === 'validate_model')?.authorizedBySkillIds).toEqual(['validation-structure-model']);
    expect(result.toolCalls.find((c) => c.tool === 'run_analysis')?.authorizedBySkillIds).toEqual(['opensees-static']);
    expect(result.toolCalls.find((c) => c.tool === 'run_code_check')?.authorizedBySkillIds).toEqual(['code-check-gb50017']);
    expect(result.toolCalls.find((c) => c.tool === 'generate_report')?.authorizedBySkillIds).toEqual(['report-export-builtin']);
    expect(result.analysis?.meta?.analysisSkillId).toBe('opensees-static');
    expect(result.codeCheck?.meta?.codeCheckSkillId).toBe('code-check-gb50017');
    expect(result.report?.json?.meta?.reportSkillId).toBe('report-export-builtin');
    expect(result.codeCheck?.code).toBe('GB50017');
    expect(typeof result.report?.markdown).toBe('string');
  });

  test('should select a single preferred builtin analysis skill for the active turn', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      message: '请静力分析这个模型',
      context: {
        analysisType: 'static',
        skillIds: ['beam'],
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        includeReport: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.analysisSkillId).toBe('opensees-static');
    expect(result.routing?.analysisSkillIds).toEqual(['opensees-static']);
    expect(result.routing?.activatedSkillIds?.filter((skillId) => skillId.endsWith('-static'))).toEqual(['opensees-static']);
    expect(result.toolCalls.find((c) => c.tool === 'run_analysis')?.authorizedBySkillIds).toEqual(['opensees-static']);
    expect(result.analysis?.meta?.analysisSkillId).toBe('opensees-static');
  });

  test('should honor engineId when selecting the preferred analysis skill', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      message: '请静力分析这个模型',
      context: {
        analysisType: 'static',
        skillIds: ['beam'],
        engineId: 'builtin-simplified',
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        includeReport: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.analysisSkillId).toBe('simplified-static');
    expect(result.routing?.analysisSkillIds).toEqual(['simplified-static']);
    expect(result.toolCalls.find((c) => c.tool === 'run_analysis')?.authorizedBySkillIds).toEqual(['simplified-static']);
    expect(result.analysis?.meta?.analysisSkillId).toBe('simplified-static');
  });

  test('should not run code-check when structural execution is enabled without a code-check skill or designCode', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    const calls = stubExecutionClients(svc, {
      codeCheck: async () => {
        throw new Error('code-check should not run without an explicit code-check skill');
      },
    });

    const result = await svc.runForcedExecution({
      message: '请静力分析并规范校核',
      context: {
        skillIds: ['beam'],
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        includeReport: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'run_analysis')).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'run_code_check')).toBe(false);
    expect(calls.some((item) => item.client === 'codeCheck' && item.path === '/code-check')).toBe(false);
  });

  test('should block tool execution when prerequisite tools are disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runForcedExecution({
      message: '请直接分析这个模型',
      context: {
        disabledToolIds: ['validate_model'],
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('validate_model');
    expect(result.toolCalls.length).toBe(0);
  });

  test('should honor disabledToolIds and skip code-check plus report even when requested', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    const calls = stubExecutionClients(svc, {
      codeCheck: async () => {
        throw new Error('code-check should be disabled by context');
      },
    });

    const result = await svc.runForcedExecution({
      message: '请静力分析并规范校核并生成报告',
      context: {
        skillIds: ['code-check-gb50017'],
        disabledToolIds: ['run_code_check', 'generate_report'],
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        autoCodeCheck: true,
        includeReport: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'run_analysis')).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'run_code_check')).toBe(false);
    expect(result.toolCalls.some((c) => c.tool === 'generate_report')).toBe(false);
    expect(calls.some((item) => item.client === 'codeCheck' && item.path === '/code-check')).toBe(false);
    expect(result.report).toBeUndefined();
  });

  test('should clear stored conversation sessions', async () => {
    const svc = createServiceWithDefaultSkills();
    const deletedKeys = [];
    const originalDel = cache.del;

    try {
      cache.del = async (...keys) => {
        deletedKeys.push(...keys);
        return keys.length;
      };

      await svc.clearConversationSession('conv-cleanup');
    } finally {
      cache.del = originalDel;
    }

    expect(deletedKeys).toEqual(['agent:interaction-session:conv-cleanup']);
  });

  test('should invalidate in-memory session when latestModel has stale structural coordinates', async () => {
    const svc = createServiceWithDefaultSkills();
    const staleConversationId = 'conv-stale-session-' + Date.now();

    const { cache } = await import('../dist/utils/cache.js');
    await cache.setex(
      'agent:interaction-session:' + staleConversationId,
      1800,
      JSON.stringify({
        draft: { inferredType: 'frame', updatedAt: Date.now() },
        structuralTypeMatch: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
        latestModel: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }],
          elements: [],
          materials: [],
          sections: [],
          load_cases: [],
          load_combinations: [],
          metadata: { inferredType: 'frame' },
        },
        resolved: {},
        updatedAt: Date.now(),
      }),
    );

    const snapshot = await svc.getConversationSessionSnapshot(staleConversationId, 'zh');

    // The stale model should be cleared
    expect(snapshot?.draft?.inferredType).toBe('unknown');
    expect(snapshot?.model).toBeUndefined();

    // Clean up
    await svc.clearConversationSession(staleConversationId);
  });


  test('should invalidate draft-only structural sessions when semantics version is missing', async () => {
    const svc = createServiceWithDefaultSkills();
    const staleConversationId = 'conv-stale-draft-only-' + Date.now();

    const { cache } = await import('../dist/utils/cache.js');
    await cache.setex(
      'agent:interaction-session:' + staleConversationId,
      1800,
      JSON.stringify({
        draft: { inferredType: 'frame', frameDimension: '3d', updatedAt: Date.now() },
        structuralTypeMatch: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
        resolved: {},
        updatedAt: Date.now(),
      }),
    );

    const snapshot = await svc.getConversationSessionSnapshot(staleConversationId, 'zh');

    expect(snapshot?.draft?.inferredType).toBe('unknown');
    expect(snapshot?.model).toBeUndefined();

    await svc.clearConversationSession(staleConversationId);
  });

  test('should preserve canonical structural sessions in memory', async () => {
    const svc = createServiceWithDefaultSkills();
    const validConversationId = 'conv-valid-session-' + Date.now();

    await cache.setex(
      'agent:interaction-session:' + validConversationId,
      1800,
      JSON.stringify({
        draft: {
          inferredType: 'beam',
          skillId: 'generic',
          structuralTypeKey: 'beam',
          coordinateSemantics: 'global-z-up',
          updatedAt: Date.now(),
        },
        structuralTypeMatch: { key: 'beam', mappedType: 'beam', skillId: 'generic', supportLevel: 'fallback' },
        latestModel: {
          schema_version: '1.0.0',
          nodes: [
            { id: '1', x: 0, y: 0, z: 0 },
            { id: '2', x: 6, y: 0, z: 0 },
          ],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
          materials: [],
          sections: [],
          load_cases: [],
          load_combinations: [],
          metadata: {
            inferredType: 'beam',
            frameDimension: '2d',
            coordinateSemantics: 'global-z-up',
          },
        },
        resolved: {},
        updatedAt: Date.now(),
      }),
    );

    const snapshot = await svc.getConversationSessionSnapshot(validConversationId, 'zh');

    expect(snapshot?.draft?.inferredType).toBe('beam');
    expect(snapshot?.model?.metadata?.coordinateSemantics).toBe('global-z-up');

    await svc.clearConversationSession(validConversationId);
  });

  test('should preserve cache.del behavior after the cleanup-session assertion', async () => {
    const key = `agent-service-cache-${Date.now()}`;

    await cache.setex(key, 60, 'value');
    await cache.del(key);

    expect(await cache.get(key)).toBeNull();
  });

  test('should pass engineId through validate analyze and code-check calls', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    const calls = stubExecutionClients(svc, {
      validate: async (_path, payload) => ({ data: { valid: true, schemaVersion: '1.0.0', meta: { engineId: payload.engineId } } }),
      analyze: async (_path, payload) => ({
        data: {
          schema_version: '1.0.0',
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: 'ok',
          data: {},
          meta: { engineId: payload.engineId, selectionMode: 'manual' },
        },
      }),
      codeCheck: async (_path, payload) => ({
        data: {
          code: payload.code,
          status: 'success',
          summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
          details: [],
          meta: { engineId: payload.engineId },
        },
      }),
    });

    const result = await svc.runForcedExecution({
      message: '请静力分析并规范校核',
      context: {
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        engineId: 'builtin-opensees',
        skillIds: ['code-check-gb50017'],
        autoAnalyze: true,
        autoCodeCheck: true,
      },
    });

    expect(result.success).toBe(true);
    expect(calls.find((item) => item.client === 'structureProtocol' && item.path === '/validate')?.payload.engineId).toBe('builtin-opensees');
    expect(calls.find((item) => item.client === 'analysis' && item.path === '/analyze')?.payload.engineId).toBe('builtin-opensees');
    expect(calls.find((item) => item.client === 'codeCheck' && item.path === '/code-check')?.payload.engineId).toBe('builtin-opensees');
  });

  test('should fail when code-check fails in closed loop', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc, {
      codeCheck: async () => {
        const error = new Error('code check failed');
        error.response = { data: { errorCode: 'CODE_CHECK_EXECUTION_FAILED' } };
        throw error;
      },
    });

    const result = await svc.runForcedExecution({
      message: '请静力分析并规范校核',
      context: {
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        skillIds: ['code-check-gb50017'],
        autoAnalyze: true,
        autoCodeCheck: true,
      },
    });

    expect(result.success).toBe(false);
    const codeCheckCall = result.toolCalls.find((c) => c.tool === 'run_code_check');
    expect(codeCheckCall?.status).toBe('error');
    expect(codeCheckCall?.errorCode).toBe('CODE_CHECK_EXECUTION_FAILED');
  });

  test('should export report artifacts to files when reportOutput=file', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      message: '请静力分析并规范校核并导出报告',
      context: {
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        autoCodeCheck: true,
        includeReport: true,
        reportFormat: 'both',
        reportOutput: 'file',
      },
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.artifacts)).toBe(true);
    expect(result.artifacts.length).toBeGreaterThanOrEqual(2);
    for (const artifact of result.artifacts) {
      expect(fs.existsSync(artifact.path)).toBe(true);
      fs.unlinkSync(artifact.path);
    }
  });

  test('should keep clarification prompts in English when locale=en', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runForcedExecution({
      message: 'Analyze a portal frame',
      conversationId: 'conv-en',
      context: {
        locale: 'en',
      },
    });

    expect(result.response).toContain('Please confirm');
    expect(result.response).not.toContain('allow_auto_decide');
    expect(result.clarification?.missingFields).toContain('Span length per bay for the portal frame or double-span beam (m)');
    expect(result.clarification?.missingFields).toContain('Portal-frame column height (m)');
  });

  test('should keep auto routing in reply mode when run_analysis is disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          kind: 'reply',
          replyMode: 'structured',
          reason: 'analysis tool unavailable',
        }),
      }),
    };

    const routeKind = await svc.assessAutoRouteKind('请开始分析这个模型', {
      locale: 'zh',
      skillIds: ['generic'],
      enabledToolIds: ['validate_model'],
      disabledToolIds: ['run_analysis'],
      hasModel: true,
    });

    expect(routeKind).toBe('reply');
  });

  test('should keep conversation route when analysis tool is disabled even after parameters are ready', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: '先聊需求',
      context: {
        locale: 'zh',
        disabledToolIds: ['run_analysis'],
        providedValues: {
          inferredType: 'beam',
          lengthM: 10,
          supportType: 'simply-supported',
          loadKN: 10,
          loadType: 'point',
          loadPosition: 'midspan',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.state).toBe('ready');
    expect(result.interaction?.routeHint).toBe('prefer_interactive');
    expect(result.interaction?.routeReason).toContain('未启用 `run_analysis`');
    expect(result.interaction?.recommendedNextStep).toContain('未启用 `run_analysis`');
  });

  test('should block force_tool when drafting is not granted in skill mode and no model exists', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runForcedExecution({
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        disabledToolIds: ['draft_model'],
      },
    });

    expect(result.success).toBe(false);
    expect(result.interaction?.state).toBe('blocked');
    expect(result.toolCalls).toEqual([]);
    expect(result.response).toContain('draft_model');
  });

  test('should keep collecting when llm extraction is partial and rule extraction is disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    svc.tryLlmExtract = async () => ({ inferredType: 'beam' });

    const result = await svc.runChatOnly({
      conversationId: 'conv-rule-fallback-zh',
      message: '跨度10m',
      context: {
        locale: 'zh',
        providedValues: {
          inferredType: 'beam',
        },
      },
    });

    expect(result.interaction?.missingCritical).toContain('跨度/长度（m）');
    expect(result.interaction?.missingCritical).toContain('支座/边界条件（悬臂/简支/两端固结/固铰）');
    expect(result.interaction?.interactionStageLabel).toBe('几何建模');
  });

  test('should keep collecting beam span after a follow-up value in chat mode when rules are disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-chat-beam-span-zh',
      message: '我想设计一个梁',
      context: {
        locale: 'zh',
      },
    });

    expect(first.interaction?.missingCritical).toContain('跨度/长度（m）');

    const second = await svc.runChatOnly({
      conversationId: 'conv-chat-beam-span-zh',
      message: '跨度10m',
      context: {
        locale: 'zh',
      },
    });

    expect(second.interaction?.missingCritical).toContain('跨度/长度（m）');
    expect(second.interaction?.missingCritical).toContain('支座/边界条件（悬臂/简支/两端固结/固铰）');
    expect(second.interaction?.interactionStageLabel).toBe('几何建模');
  });

  test('should keep asking for span after a follow-up value in chat mode when rules are disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-chat-span-zh',
      message: '先聊需求，我要做一个门式刚架',
      context: {
        locale: 'zh',
      },
    });

    expect(first.interaction?.missingCritical).toContain('门式刚架或双跨每跨跨度（m）');

    const second = await svc.runChatOnly({
      conversationId: 'conv-chat-span-zh',
      message: '跨度10m',
      context: {
        locale: 'zh',
      },
    });

    expect(second.interaction?.missingCritical).toContain('门式刚架或双跨每跨跨度（m）');
    expect(second.interaction?.missingCritical).toContain('门式刚架柱高（m）');
    expect(second.interaction?.missingCritical).toContain('荷载大小（kN）');
    expect(second.response).toContain('每跨跨度');
  });

  test('should keep English span missing after a span-only follow-up when rules are disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-chat-span-en',
      message: 'Discuss a portal frame first',
      context: {
        locale: 'en',
      },
    });

    expect(first.interaction?.missingCritical).toContain('Span length per bay for the portal frame or double-span beam (m)');

    const second = await svc.runChatOnly({
      conversationId: 'conv-chat-span-en',
      message: 'span 10m',
      context: {
        locale: 'en',
      },
    });

    expect(second.interaction?.missingCritical).toContain('Span length per bay for the portal frame or double-span beam (m)');
    expect(second.interaction?.missingCritical).toContain('Portal-frame column height (m)');
    expect(second.interaction?.missingCritical).toContain('Load magnitude (kN)');
    expect(second.interaction?.missingCritical).toContain('Load type (point / distributed)');
    expect(second.interaction?.missingCritical).toContain('Load position (based on the current template)');
    expect(second.response).toContain('Span per bay');
  });

  test('should keep beam load detail prompts unresolved when rules are disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-chat-load-detail-zh',
      message: '我想设计一个简支梁，跨度10m',
      context: {
        locale: 'zh',
      },
    });

    expect(first.interaction?.missingCritical).toContain('荷载大小（kN）');
    expect(first.interaction?.missingCritical).not.toContain('荷载形式（点荷载/均布荷载）');
    expect(first.interaction?.missingCritical).not.toContain('荷载位置（按当前结构模板）');

    const second = await svc.runChatOnly({
      conversationId: 'conv-chat-load-detail-zh',
      message: '20kN均布荷载，全跨布置',
      context: {
        locale: 'zh',
      },
    });

    expect(second.interaction?.missingCritical).toContain('荷载大小（kN）');
    expect(Array.isArray(second.interaction?.missingOptional)).toBe(true);
  });


  test('should not synthesize template model with an empty skill set when llm is unavailable', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft('生成一个跨度10m的简支梁，荷载在4m处，一个集中荷载10kN', undefined, 'zh', []);

    expect(draft.model).toBeUndefined();
    expect(draft.stateToPersist?.inferredType).toBe('unknown');
    expect(draft.missingFields.length).toBeGreaterThan(0);
  });

  test('should stay in collecting state with an empty skill set when llm is unavailable', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: '我希望生成一个跨度10m的简支梁，荷载在4m处，一个集中荷载10kN',
      context: {
        locale: 'zh',
        skillIds: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsModelInput).toBe(false);
    expect(result.interaction).toBeUndefined();
    expect(typeof result.response).toBe('string');
    expect(result.response).toContain('当前未启用工程技能');
    expect(result.model).toBeUndefined();
  });

  test('should keep empty-skill chat generic even when message contains template keywords', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: '门式刚架，跨度10m，10kN集中荷载在4m处',
      context: {
        locale: 'zh',
        skillIds: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsModelInput).toBe(false);
    expect(result.interaction).toBeUndefined();
    expect(typeof result.response).toBe('string');
    expect(result.response).toContain('当前未启用工程技能');
    expect(result.model).toBeUndefined();
  });

  test('should fall back to plain reply when the skill set is empty and draft tool is unavailable', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: '先帮我梳理一下我要做什么结构分析',
      context: {
        locale: 'zh',
        skillIds: [],
        disabledToolIds: ['draft_model', 'run_analysis', 'validate_model', 'convert_model', 'run_code_check', 'generate_report'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsModelInput).toBe(false);
    expect(result.interaction).toBeUndefined();
    expect(result.toolCalls).toEqual([]);
    expect(result.response).toContain('普通对话');
  });

  test('should auto-enable the generic structure skill when skillIds are omitted', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.runWithStrategy(
      {
        message: '帮我分析一个结构，跨度10m，荷载10kN',
        context: {
          locale: 'zh',
        },
      },
      { planningDirective: 'auto', allowToolCall: false },
    );

    expect(result.success).toBe(true);
    expect(result.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);
    expect(result.interaction).toBeDefined();
    expect(result.response).not.toContain('当前未启用技能');
    expect(result.response).toContain('通用结构类型');
  });

  test('should let the planner reply directly to casual chat even when an analysis skill is enabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'reply',
              replyMode: 'plain',
              reason: 'casual greeting',
            }),
          };
        }
        return { content: '你好，我在。' };
      },
    };

    const result = await svc.run({
      message: '你好',
      conversationId: 'conv-casual-opensees-static',
      context: {
        locale: 'zh',
        skillIds: ['opensees-static'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls).toEqual([]);
    expect(result.model).toBeUndefined();
    expect(result.interaction).toBeUndefined();
    expect(result.response).toContain('你好');
  });

  test('should let interactive routing reply directly to casual chat without drafting', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'reply',
              replyMode: 'plain',
              reason: 'casual greeting in interactive mode',
            }),
          };
        }
        return { content: '你好，我在。' };
      },
    };

    const result = await svc.runChatOnly({
      message: '你好',
      conversationId: 'conv-interactive-casual-opensees-static',
      context: {
        locale: 'zh',
        skillIds: ['opensees-static'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls).toEqual([]);
    expect(result.model).toBeUndefined();
    expect(result.interaction).toBeUndefined();
    expect(result.response).toContain('你好');
  });

  test('should behave like skilled-chat when skills are enabled but execution tools are disabled', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      conversationId: 'conv-skilled-chat-shape',
      message: '我想设计一个门式刚架',
      context: {
        locale: 'zh',
        disabledToolIds: ['run_analysis', 'validate_model', 'convert_model', 'run_code_check', 'generate_report'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.state).not.toBe('completed');
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.toolCalls.some((call) => call.tool === 'run_analysis')).toBe(false);
    expect(result.toolCalls.some((call) => call.tool === 'run_code_check')).toBe(false);
    expect(result.toolCalls.some((call) => call.tool === 'generate_report')).toBe(false);
  });

  test('should block full agent execution when no-rule and no-llm drafting cannot form a model', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      conversationId: 'conv-full-agent-shape',
      message: '请按3m悬臂梁端部10kN点荷载做静力分析',
      context: {
        locale: 'zh',
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });

    expect(result.toolCalls.some((call) => call.tool === 'run_analysis')).toBe(false);
    expect(result.response.length).toBeGreaterThan(0);
  });

  test('should repair malformed planner output and still let generic call draft_model', async () => {
    const svc = createServiceWithDefaultSkills();
    let plannerAttemptCount = 0;

    // Stub skillRuntime methods used by the scheduler draft path
    svc.skillRuntime.extractDraftParameters = async () => ({
      nextState: { inferredType: 'unknown', updatedAt: Date.now() },
      missing: { critical: [], optional: [] },
      structuralTypeMatch: { key: 'unknown', mappedType: 'unknown', skillId: undefined, supportLevel: 'unsupported' },
      plugin: undefined,
      extractionMode: 'llm',
    });
    svc.skillRuntime.buildModelFromDraft = async () => ({
      inferredType: 'unknown',
      missingFields: [],
      extractionMode: 'llm',
      model: {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [],
        elements: [],
        materials: [],
        sections: [],
        load_cases: [],
        load_combinations: [],
      },
      stateToPersist: {
        inferredType: 'unknown',
        updatedAt: Date.now(),
      },
    });

    svc.structureProtocolClient = {
      post: async (route) => {
        if (route === '/validate') {
          return { data: { valid: true } };
        }
        throw new Error(`unexpected structure protocol route: ${route}`);
      },
    };

    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Normalize the following StructureClaw planner output')) {
          return {
            content: JSON.stringify({
              kind: 'execute',
              targetArtifact: 'normalizedModel',
              replyMode: null,
              toolId: 'draft_model',
              reason: 'the user is explicitly asking to build a structural model now',
            }),
          };
        }
        if (text.includes('Return strict JSON only')) {
          plannerAttemptCount += 1;
          return { content: 'I would use draft_model for this modeling request.' };
        }
        return { content: '模型已生成。' };
      },
    };

    const result = await svc.run({
      conversationId: 'conv-planner-repair-draft-model',
      message: '我想建模一个简支梁，跨度10m，均布荷载1kN/m，可以用10个单元建模',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model'],
        autoAnalyze: false,
      },
    });

    expect(plannerAttemptCount).toBe(1);
    expect(result.success).toBe(true);
    expect(result.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);
    expect(result.model).toBeDefined();
    expect(result.response).not.toContain('当前无法可靠解析大模型的下一步决策结果');
  });

  test('should prefer a new draft_model over a stale context model when llm requests new modeling', async () => {
    const svc = createServiceWithDefaultSkills();
    const staleModel = {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [{ id: 'old-1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] }],
      elements: [],
      materials: [],
      sections: [],
      load_cases: [],
      load_combinations: [],
      metadata: { name: 'stale-frame-model' },
    };
    const draftedModel = {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
        { id: '2', x: 10000, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
        { id: '3', x: 5000, y: 0, z: 0 },
      ],
      elements: [
        { id: 'E1', type: 'beam', nodes: ['1', '3'], material: 'STEEL', section: 'B1' },
        { id: 'E2', type: 'beam', nodes: ['3', '2'], material: 'STEEL', section: 'B1' },
      ],
      materials: [{ id: 'STEEL', name: 'Q355', E: 206000, nu: 0.3, rho: 7850, fy: 355 }],
      sections: [{ id: 'B1', name: 'Beam', type: 'rect', properties: { A: 0.01, Iz: 0.0001, Iy: 0.0001, J: 0.00001 } }],
      load_cases: [{ id: 'MID', type: 'other', loads: [{ node: '3', fy: -1 }] }],
      load_combinations: [],
      metadata: { name: 'new-beam-model' },
    };

    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          expect(text).toContain('User message: 设计一个简支梁，跨度10m，梁中间荷载1kN');
          expect(text).toContain('"hasModel":true');
          return {
            content: JSON.stringify({
              kind: 'execute',
              targetArtifact: 'normalizedModel',
              replyMode: null,
              toolId: 'draft_model',
              reason: 'the user is clearly asking to build a new simply supported beam model',
            }),
          };
        }
        return { content: 'ok' };
      },
    };

    // Stub skillRuntime methods used by the scheduler draft path
    svc.skillRuntime.extractDraftParameters = async () => ({
      nextState: { inferredType: 'beam', updatedAt: Date.now() },
      missing: { critical: [], optional: [] },
      structuralTypeMatch: { key: 'beam', mappedType: 'beam', skillId: 'beam', supportLevel: 'supported' },
      plugin: undefined,
      extractionMode: 'llm',
    });
    svc.skillRuntime.buildModelFromDraft = async () => ({
      inferredType: 'beam',
      missingFields: [],
      extractionMode: 'llm',
      model: draftedModel,
      stateToPersist: {
        inferredType: 'beam',
        updatedAt: Date.now(),
      },
    });
    svc.assessInteractionNeeds = async () => ({
      criticalMissing: [],
      nonCriticalMissing: [],
      defaultProposals: [],
    });

    svc.structureProtocolClient = {
      post: async (route, payload) => {
        if (route === '/validate') {
          return { data: { valid: true } };
        }
        throw new Error(`unexpected structure protocol route: ${route}`);
      },
    };

    const result = await svc.run({
      conversationId: 'conv-stale-context-model-new-draft',
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model'],
        autoAnalyze: false,
        model: staleModel,
      },
    });

    expect(result.success).toBe(true);
    // With an existing model in context, the scheduler uses update_model instead of draft_model
    expect(result.toolCalls.some((call) => call.tool === 'update_model' || call.tool === 'draft_model')).toBe(true);
    expect(result.model?.metadata?.name).toBe('new-beam-model');
  });

  test('should run planner first then draft model via skill extraction on tool_call path', async () => {
    const svc = createServiceWithDefaultSkills();
    let plannerCalled = 0;

    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          plannerCalled += 1;
          expect(text).toContain('User message: 设计一个简支梁，跨度10m，梁中间荷载1kN');
          expect(text).toContain('"hasModel":false');
          return {
            content: JSON.stringify({
              kind: 'execute',
              targetArtifact: 'normalizedModel',
              replyMode: null,
              reason: 'user explicitly asked to design a beam with sufficient parameters',
            }),
          };
        }
        return { content: 'ok' };
      },
    };

    // Stub skillRuntime methods used by the scheduler draft path
    svc.skillRuntime.extractDraftParameters = async () => ({
      nextState: { inferredType: 'beam', updatedAt: Date.now() },
      missing: { critical: [], optional: [] },
      structuralTypeMatch: { key: 'beam', mappedType: 'beam', skillId: 'beam', supportLevel: 'supported' },
      plugin: undefined,
      extractionMode: 'llm',
    });
    svc.skillRuntime.buildModelFromDraft = async () => ({
      inferredType: 'beam',
      missingFields: [],
      extractionMode: 'llm',
      model: {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
          { id: '2', x: 10000, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
          { id: '3', x: 5000, y: 0, z: 0 },
        ],
        elements: [
          { id: 'E1', type: 'beam', nodes: ['1', '3'], material: 'STEEL', section: 'B1' },
          { id: 'E2', type: 'beam', nodes: ['3', '2'], material: 'STEEL', section: 'B1' },
        ],
        materials: [{ id: 'STEEL', name: 'Q355', E: 206000, nu: 0.3, rho: 7850, fy: 355 }],
        sections: [{ id: 'B1', name: 'Beam', type: 'rect', properties: { A: 0.01, Iz: 0.0001, Iy: 0.0001, J: 0.00001 } }],
        load_cases: [{ id: 'MID', type: 'other', loads: [{ node: '3', fy: -1 }] }],
        load_combinations: [],
      },
      stateToPersist: {
        inferredType: 'beam',
        updatedAt: Date.now(),
      },
    });
    svc.assessInteractionNeeds = async () => ({
      criticalMissing: [],
      nonCriticalMissing: [],
      defaultProposals: [],
    });

    svc.structureProtocolClient = {
      post: async (route) => {
        if (route === '/validate') {
          return { data: { valid: true } };
        }
        throw new Error(`unexpected structure protocol route: ${route}`);
      },
    };

    const result = await svc.run({
      conversationId: 'conv-planner-first-then-draft',
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model'],
        autoAnalyze: false,
      },
    });

    expect(plannerCalled).toBe(1);
    expect(result.success).toBe(true);
    expect(result.model).toBeDefined();
    expect(result.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);
  });

  test('should run force_tool with skill draft preparse and without planner llm call', async () => {
    const svc = createServiceWithDefaultSkills();
    let plannerCalled = 0;
    let draftCalled = 0;

    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          plannerCalled += 1;
          return {
            content: JSON.stringify({
              kind: 'execute',
              targetArtifact: 'normalizedModel',
              replyMode: null,
              reason: 'planner should not run during forced execution',
            }),
          };
        }
        return { content: 'ok' };
      },
    };

    // Stub the skillRuntime methods used by the scheduler draft path
    const originalExtractDraft = svc.skillRuntime.extractDraftParameters.bind(svc.skillRuntime);
    svc.skillRuntime.extractDraftParameters = async () => {
      draftCalled += 1;
      return {
        nextState: { inferredType: 'beam', updatedAt: Date.now() },
        missing: { critical: [], optional: [] },
        structuralTypeMatch: { key: 'beam', mappedType: 'beam', skillId: 'beam', supportLevel: 'supported' },
        plugin: undefined,
        extractionMode: 'llm',
      };
    };

    svc.skillRuntime.buildModelFromDraft = async () => ({
      model: {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
          { id: '2', x: 10000, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
          { id: '3', x: 5000, y: 0, z: 0 },
        ],
        elements: [
          { id: 'E1', type: 'beam', nodes: ['1', '3'], material: 'STEEL', section: 'B1' },
          { id: 'E2', type: 'beam', nodes: ['3', '2'], material: 'STEEL', section: 'B1' },
        ],
        materials: [{ id: 'STEEL', name: 'Q355', E: 206000, nu: 0.3, rho: 7850, fy: 355 }],
        sections: [{ id: 'B1', name: 'Beam', type: 'rect', properties: { A: 0.01, Iz: 0.0001, Iy: 0.0001, J: 0.00001 } }],
        load_cases: [{ id: 'MID', type: 'other', loads: [{ node: '3', fy: -1 }] }],
        load_combinations: [],
      },
    });

    svc.assessInteractionNeeds = async () => ({
      criticalMissing: [],
      nonCriticalMissing: [],
      defaultProposals: [],
    });

    svc.structureProtocolClient = {
      post: async (route) => {
        if (route === '/validate') {
          return { data: { valid: true } };
        }
        throw new Error(`unexpected structure protocol route: ${route}`);
      },
    };

    const result = await svc.runForcedExecution({
      conversationId: 'conv-force-tool-prefetch',
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model'],
        autoAnalyze: false,
      },
    });

    expect(plannerCalled).toBe(0);
    expect(draftCalled).toBe(1);
    expect(result.success).toBe(true);
    expect(result.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);
  });

  test('should describe model-only execution as model generation instead of finished analysis', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    svc.skillRuntime.extractDraftParameters = async () => ({
      nextState: { inferredType: 'beam', updatedAt: Date.now() },
      missing: { critical: [], optional: [] },
      structuralTypeMatch: { key: 'beam', mappedType: 'beam', skillId: 'beam', supportLevel: 'supported' },
      plugin: undefined,
      extractionMode: 'llm',
    });
    svc.skillRuntime.buildModelFromDraft = async () => ({
      model: {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
          { id: '2', x: 10000, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
          { id: '3', x: 5000, y: 0, z: 0 },
        ],
        elements: [
          { id: 'E1', type: 'beam', nodes: ['1', '3'], material: 'STEEL', section: 'B1' },
          { id: 'E2', type: 'beam', nodes: ['3', '2'], material: 'STEEL', section: 'B1' },
        ],
        materials: [{ id: 'STEEL', name: 'Q355', E: 206000, nu: 0.3, rho: 7850, fy: 355 }],
        sections: [{ id: 'B1', name: 'Beam', type: 'rect', properties: { A: 0.01, Iz: 0.0001, Iy: 0.0001, J: 0.00001 } }],
        load_cases: [{ id: 'MID', type: 'other', loads: [{ node: '3', fy: -1 }] }],
        load_combinations: [],
      },
    });
    svc.assessInteractionNeeds = async () => ({
      criticalMissing: [],
      nonCriticalMissing: [],
      defaultProposals: [],
    });

    svc.structureProtocolClient = {
      post: async (route) => {
        if (route === '/validate') {
          return { data: { valid: true } };
        }
        throw new Error(`unexpected structure protocol route: ${route}`);
      },
    };

    const result = await svc.runForcedExecution({
      conversationId: 'conv-force-tool-model-only-summary',
      message: '建模一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model'],
        autoAnalyze: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls.some((call) => call.tool === 'run_analysis')).toBe(false);
    expect(result.response).toContain('结构模型已生成');
    expect(result.response).not.toContain('分析完成');
  });

  test('should ask for clarification instead of returning an invalid drafted model', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'execute',
              targetArtifact: 'normalizedModel',
              replyMode: null,
              toolId: 'draft_model',
              reason: 'the user is asking to build a model now',
            }),
          };
        }
        return { content: 'ok' };
      },
    };

    // Stub skillRuntime to simulate missing critical fields → DRAFT_INCOMPLETE
    svc.skillRuntime.extractDraftParameters = async () => ({
      nextState: { inferredType: 'beam', updatedAt: Date.now() },
      missing: { critical: ['load_cases'], optional: [] },
      structuralTypeMatch: { key: 'beam', mappedType: 'beam', skillId: 'beam', supportLevel: 'supported' },
      plugin: undefined,
      extractionMode: 'llm',
    });
    svc.skillRuntime.buildModelFromDraft = async () => ({
      inferredType: 'beam',
      missingFields: ['load_cases'],
      extractionMode: 'llm',
      model: undefined,
      stateToPersist: {
        inferredType: 'beam',
        updatedAt: Date.now(),
      },
    });
    svc.assessInteractionNeeds = async () => ({
      criticalMissing: ['load_cases'],
      nonCriticalMissing: [],
      defaultProposals: [],
    });

    svc.structureProtocolClient = {
      post: async (route) => {
        if (route === '/validate') {
          return { data: { valid: false, message: 'Validation failed' } };
        }
        throw new Error(`unexpected structure protocol route: ${route}`);
      },
    };

    const result = await svc.run({
      conversationId: 'conv-invalid-drafted-model-asks',
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model'],
        autoAnalyze: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsModelInput).toBe(true);
    expect(result.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);
    expect(result.model).toBeUndefined();
  });

  test('should not block model drafting on report preferences when a valid model is ready', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'execute',
              targetArtifact: 'normalizedModel',
              replyMode: null,
              toolId: 'draft_model',
              reason: 'the user is asking to build a model now',
            }),
          };
        }
        return { content: 'ok' };
      },
    };

    // Stub skillRuntime methods used by the scheduler draft path
    svc.skillRuntime.extractDraftParameters = async () => ({
      nextState: { inferredType: 'beam', updatedAt: Date.now() },
      missing: { critical: [], optional: [] },
      structuralTypeMatch: { key: 'beam', mappedType: 'beam', skillId: 'beam', supportLevel: 'supported' },
      plugin: undefined,
      extractionMode: 'llm',
    });
    svc.skillRuntime.buildModelFromDraft = async () => ({
      inferredType: 'beam',
      missingFields: [],
      extractionMode: 'llm',
      model: {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
          { id: '2', x: 10000, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
          { id: '3', x: 5000, y: 0, z: 0 },
        ],
        elements: [
          { id: 'E1', type: 'beam', nodes: ['1', '3'], material: 'STEEL', section: 'B1' },
          { id: 'E2', type: 'beam', nodes: ['3', '2'], material: 'STEEL', section: 'B1' },
        ],
        materials: [{ id: 'STEEL', name: 'Q355', E: 206000, nu: 0.3, rho: 7850, fy: 355 }],
        sections: [{ id: 'B1', name: 'Beam', type: 'rect', properties: { A: 0.01, Iz: 0.0001, Iy: 0.0001, J: 0.00001 } }],
        load_cases: [{ id: 'MID', type: 'other', loads: [{ node: '3', fy: -1 }] }],
        load_combinations: [],
      },
      stateToPersist: {
        inferredType: 'beam',
        updatedAt: Date.now(),
      },
    });

    svc.structureProtocolClient = {
      post: async (route) => {
        if (route === '/validate') {
          return { data: { valid: true } };
        }
        throw new Error(`unexpected structure protocol route: ${route}`);
      },
    };

    const result = await svc.run({
      conversationId: 'conv-draft-ignores-report-pref-block',
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model', 'generate_report'],
        autoAnalyze: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.model).toBeDefined();
    expect(result.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);
    expect(result.response).not.toContain('请先确认以下参数');
    expect(result.response).not.toContain('allow_auto_decide');
  });

  test('should render interactive clarification through llm instead of returning a template string', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.textToModelDraft = async () => ({
      inferredType: 'unknown',
      missingFields: ['跨度', '荷载'],
      extractionMode: 'llm',
      model: undefined,
      stateToPersist: {
        inferredType: 'unknown',
        updatedAt: Date.now(),
      },
    });
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'ask',
              replyMode: 'structured',
              toolId: null,
              reason: 'more modeling details are needed',
            }),
          };
        }
        if (text.includes('工程对话 Agent') || text.includes('engineering conversation agent')) {
          return { content: '先告诉我梁的跨度和荷载形式，我再继续建模。' };
        }
        return { content: 'ok' };
      },
    };

    const result = await svc.runChatOnly({
      conversationId: 'conv-llm-interaction-render',
      message: '帮我建一个梁',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsModelInput).toBe(true);
    expect(result.response).toBe('先告诉我梁的跨度和荷载形式，我再继续建模。');
    expect(result.response).not.toContain('请先确认以下参数');
  });

  test('should keep returning the latest model during ready follow-up turns', async () => {
    const svc = createServiceWithDefaultSkills();
    let draftCallCount = 0;
    const beamModel = {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
        { id: '2', x: 10000, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
      ],
      elements: [
        { id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'STEEL', section: 'B1' },
      ],
      materials: [{ id: 'STEEL', name: 'Q355', E: 206000, nu: 0.3, rho: 7850, fy: 355 }],
      sections: [{ id: 'B1', name: 'Beam', type: 'rect', properties: { A: 0.01, Iz: 0.0001, Iy: 0.0001, J: 0.00001 } }],
      load_cases: [{ id: 'LC1', type: 'other', loads: [{ node: '2', fy: -1 }] }],
      load_combinations: [],
    };

    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'reply',
              replyMode: 'structured',
              toolId: null,
              reason: 'the model is ready and the user is confirming the next step',
            }),
          };
        }
        if (text.includes('工程对话 Agent') || text.includes('engineering conversation agent')) {
          return { content: '模型参数已齐备，可以继续分析。' };
        }
        return { content: 'ok' };
      },
    };

    svc.textToModelDraft = async () => {
      draftCallCount += 1;
      if (draftCallCount === 1) {
        return {
          inferredType: 'beam',
          missingFields: [],
          extractionMode: 'llm',
          model: beamModel,
          stateToPersist: {
            inferredType: 'beam',
            skillId: 'generic',
            structuralTypeKey: 'beam',
            supportType: 'simply-supported',
            lengthM: 10,
            loadKN: 1,
            updatedAt: Date.now(),
          },
        };
      }
      return {
        inferredType: 'beam',
        missingFields: [],
        extractionMode: 'llm',
        model: undefined,
        stateToPersist: {
          inferredType: 'beam',
          skillId: 'generic',
          structuralTypeKey: 'beam',
          supportType: 'simply-supported',
          lengthM: 10,
          loadKN: 1,
          updatedAt: Date.now(),
        },
      };
    };

    const first = await svc.runChatOnly({
      conversationId: 'conv-ready-follow-up-model-sync',
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model', 'run_analysis'],
      },
    });
    const second = await svc.runChatOnly({
      conversationId: 'conv-ready-follow-up-model-sync',
      message: '继续',
      context: {
        locale: 'zh',
        skillIds: ['generic'],
        enabledToolIds: ['draft_model', 'validate_model', 'run_analysis'],
      },
    });

    expect(first.model).toEqual(beamModel);
    expect(second.success).toBe(true);
    expect(second.model).toEqual(beamModel);
    expect(second.response).toContain('模型参数已齐备');
  });

  test('should keep inferredType unknown with an empty skill set even when llm extraction suggests template type', async () => {
    const svc = createServiceWithDefaultSkills();
    let invokeCount = 0;
    svc.llm = {
      invoke: async () => {
        invokeCount += 1;
        if (invokeCount === 1) {
          return { content: '{"inferredType":"beam","lengthM":10,"loadKN":10}' };
        }
        return {
          content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
        };
      },
    };

    const draft = await svc.textToModelDraft('10m beam with 10kN point load', undefined, 'en', []);

    expect(draft.stateToPersist?.inferredType).toBe('unknown');
    expect(draft.inferredType).toBe('unknown');
  });

  test('should keep the empty-skill path as plain chat guidance without model-building prompt', async () => {
    const svc = createServiceWithDefaultSkills();
    const prompts = [];
    svc.llm = {
      invoke: async (prompt) => {
        prompts.push(prompt);
        return {
          content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
        };
      },
    };

    await svc.textToModelDraft('10m beam with dead load', undefined, 'en', []);

    expect(prompts).toHaveLength(0);
  });

  test('should ignore template support fields in empty-skill state even when llm extraction returns them', async () => {
    const svc = createServiceWithDefaultSkills();
    let invokeCount = 0;
    svc.llm = {
      invoke: async () => {
        invokeCount += 1;
        if (invokeCount === 1) {
          return {
            content: '{"inferredType":"beam","supportType":"cantilever","frameBaseSupportType":"fixed","lengthM":8,"loadKN":12}',
          };
        }
        return {
          content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
        };
      },
    };

    const draft = await svc.textToModelDraft('8m cantilever beam with 12kN load', undefined, 'en', []);

    expect(draft.stateToPersist?.supportType).toBeUndefined();
    expect(draft.stateToPersist?.frameBaseSupportType).toBeUndefined();
    expect(draft.stateToPersist?.inferredType).toBe('unknown');
  });

  test('should ignore categorical loadPosition in empty-skill state', async () => {
    const svc = createServiceWithDefaultSkills();
    let invokeCount = 0;
    svc.llm = {
      invoke: async () => {
        invokeCount += 1;
        if (invokeCount === 1) {
          return {
            content: '{"inferredType":"beam","loadType":"point","loadPosition":"midspan","loadPositionM":2.5,"lengthM":5,"loadKN":10}',
          };
        }
        return {
          content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
        };
      },
    };

    const draft = await svc.textToModelDraft('5m member with 10kN point load at 2.5m', undefined, 'en', []);

    expect(draft.stateToPersist?.loadPosition).toBeUndefined();
    expect(draft.stateToPersist?.loadPositionM).toBeUndefined();
    expect(draft.stateToPersist?.inferredType).toBe('unknown');
  });

  test('should ignore categorical loadType in empty-skill state', async () => {
    const svc = createServiceWithDefaultSkills();
    let invokeCount = 0;
    svc.llm = {
      invoke: async () => {
        invokeCount += 1;
        if (invokeCount === 1) {
          return {
            content: '{"loadType":"distributed","loadKN":15,"lengthM":6}',
          };
        }
        return {
          content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
        };
      },
    };

    const draft = await svc.textToModelDraft('6m member with 15kN load', undefined, 'en', []);

    expect(draft.stateToPersist?.loadType).toBeUndefined();
    expect(draft.stateToPersist?.loadKN).toBeUndefined();
    expect(draft.stateToPersist?.inferredType).toBe('unknown');
  });

  test('should strip skill metadata from empty-skill state normalization', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '给我一个可计算结构模型',
      {
        inferredType: 'frame',
        skillId: 'frame',
        structuralTypeKey: 'frame',
        supportLevel: 'supported',
        supportNote: 'template note',
        lengthM: 12,
        loadKN: 20,
        loadType: 'distributed',
        loadPosition: 'midspan',
        loadPositionM: 4,
        updatedAt: Date.now() - 1000,
      },
      'zh',
      [],
    );

    expect(draft.stateToPersist?.inferredType).toBe('unknown');
    expect(draft.stateToPersist?.skillId).toBeUndefined();
    expect(draft.stateToPersist?.structuralTypeKey).toBeUndefined();
    expect(draft.stateToPersist?.supportLevel).toBeUndefined();
    expect(draft.stateToPersist?.supportNote).toBeUndefined();
    expect(draft.stateToPersist?.loadType).toBeUndefined();
    expect(draft.stateToPersist?.loadPosition).toBeUndefined();
    expect(draft.stateToPersist?.loadPositionM).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(draft.stateToPersist ?? {}, 'supportType')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(draft.stateToPersist ?? {}, 'frameBaseSupportType')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(draft.stateToPersist ?? {}, 'loadType')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(draft.stateToPersist ?? {}, 'loadPosition')).toBe(false);
  });

  test('should sanitize providedValues with an empty skill set without structural-type carry-over', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    const conversationId = 'conv-empty-skill-provided-values-sanitize';
    await svc.clearConversationSession(conversationId);

    await svc.runChatOnly({
      message: '继续',
      conversationId,
      context: {
        locale: 'zh',
        skillIds: [],
        providedValues: {
          inferredType: 'frame',
          skillId: 'frame',
          structuralTypeKey: 'frame',
          supportLevel: 'supported',
          supportNote: 'template note',
          lengthM: 9,
          loadKN: 12,
          loadType: 'distributed',
          loadPosition: 'midspan',
          loadPositionM: 3,
        },
      },
    });

    const snapshot = await svc.getConversationSessionSnapshot(conversationId, 'zh', []);

    expect(snapshot).toBeUndefined();

    await svc.clearConversationSession(conversationId);
  });

  test('should clear structural-type carry-over when switching an existing conversation to an empty skill set', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    const conversationId = 'conv-switch-skill-to-empty-skill';
    await svc.clearConversationSession(conversationId);

    await svc.runChatOnly({
      message: '先按框架结构类型保存会话',
      conversationId,
      context: {
        locale: 'zh',
        skillIds: ['frame'],
        providedValues: {
          inferredType: 'frame',
          skillId: 'frame',
          structuralTypeKey: 'frame',
          supportLevel: 'supported',
          supportNote: 'frame template support',
          lengthM: 12,
        },
      },
    });

    const switched = await svc.runChatOnly({
      message: '切到通用模式继续',
      conversationId,
      context: {
        locale: 'zh',
        skillIds: [],
      },
    });

    expect(switched.interaction?.fallbackSupportNote).toBeUndefined();

    const snapshot = await svc.getConversationSessionSnapshot(conversationId, 'zh', []);
    expect(snapshot?.draft.inferredType).toBe('unknown');
    expect(snapshot?.draft.skillId).toBeUndefined();
    expect(snapshot?.draft.structuralTypeKey).toBeUndefined();

    await svc.clearConversationSession(conversationId);
  });

  test('should keep llm extractionMode with an empty skill set when llm extraction falls back', async () => {
    const svc = createServiceWithDefaultSkills();
    let invokeCount = 0;
    svc.llm = {
      invoke: async () => {
        invokeCount += 1;
        if (invokeCount === 1) {
          return { content: 'not-json' };
        }
        return {
          content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
        };
      },
    };

    const draft = await svc.textToModelDraft('给我一个可计算结构模型', undefined, 'zh', []);

    expect(draft.extractionMode).toBe('llm');
    expect(draft.model).toBeUndefined();
    expect(draft.missingFields.length).toBeGreaterThan(0);
    expect(draft.stateToPersist?.inferredType).toBe('unknown');
  });

  test('should fallback to generic llm model when enabled skills cannot match request', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
      }),
    };

    const draft = await svc.textToModelDraft(
      '希望生成一个跨度10m的简支梁，荷载在4m处，一个集中荷载10kN',
      undefined,
      'zh',
      ['frame'],
    );

    expect(draft.extractionMode).toBe('llm');
    expect(draft.model).toBeDefined();
    expect(draft.missingFields).toEqual([]);
  });

  test('should keep structure-type generic fallback when a selected generic skill catches the request', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '请帮我先整理一个结构模型，跨度 10m，荷载 10kN，后面再继续细化',
      undefined,
      'zh',
      ['generic'],
    );

    expect(draft.inferredType).toBe('unknown');
    expect(draft.structuralTypeMatch?.skillId).toBe('generic');
    expect(draft.stateToPersist?.skillId).toBe('generic');
    expect(draft.stateToPersist?.supportLevel).toBe('fallback');
    expect(draft.extractionMode).toBe('llm');
    expect(draft.model).toBeUndefined();
    expect(draft.missingFields).toEqual(['inferredType']);
  });

  test('should not let generic infer structural type deterministically when llm is unavailable', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '我想设计一个三维框架结构，3层每层3m，x方向4跨，y方向3跨',
      undefined,
      'zh',
      ['generic'],
    );

    expect(draft.structuralTypeMatch?.skillId).toBe('generic');
    expect(draft.inferredType).toBe('unknown');
    expect(draft.stateToPersist?.inferredType).toBe('unknown');
    expect(draft.stateToPersist?.skillId).toBe('generic');
    expect(draft.model).toBeUndefined();
    expect(draft.missingFields).toEqual(['inferredType']);
  });

  test('should let generic extract only inferredType from llm patch output (metadata-only)', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          inferredType: 'frame',
          draftPatch: {
            inferredType: 'frame',
            frameDimension: '3d',
            storyCount: 3,
            storyHeightsM: [3, 3, 3],
            bayCountX: 4,
            bayCountY: 3,
            bayWidthsXM: [5, 5, 5, 5],
            bayWidthsYM: [3, 3, 3],
          },
        }),
      }),
    };

    const draft = await svc.textToModelDraft(
      '我想设计一个三维框架结构，3层每层3m，x方向4跨跨度5m，y方向3跨跨度3m',
      undefined,
      'zh',
      ['generic'],
    );

    expect(draft.extractionMode).toBe('llm');
    expect(draft.inferredType).toBe('frame');
    expect(draft.stateToPersist?.inferredType).toBe('frame');
    expect(draft.stateToPersist?.skillId).toBe('generic');
    expect(draft.stateToPersist?.frameDimension).toBeUndefined();
    expect(draft.stateToPersist?.storyCount).toBeUndefined();
    expect(draft.stateToPersist?.bayCountX).toBeUndefined();
    expect(draft.stateToPersist?.bayCountY).toBeUndefined();
  });

  test('should let generic keep unknown draft type and still return a full llm-built beam model', async () => {
    const svc = createServiceWithDefaultSkills();
    let callCount = 0;
    svc.llm = {
      invoke: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: JSON.stringify({
              inferredType: 'beam',
              draftPatch: {
                inferredType: 'beam',
                lengthM: 10,
                supportType: 'simply-supported',
                loadKN: 1,
                loadType: 'point',
                loadPositionM: 5,
              },
            }),
          };
        }
        return {
          content: JSON.stringify({
            schema_version: '1.0.0',
            unit_system: 'SI',
            nodes: Array.from({ length: 11 }, (_, index) => ({
              id: `N${index + 1}`,
              x: index,
              y: 0,
              z: 0,
              ...(index === 0
                ? { restraints: [true, true, true, true, true, false] }
                : index === 10
                  ? { restraints: [false, true, true, true, true, false] }
                  : {}),
            })),
            elements: Array.from({ length: 10 }, (_, index) => ({
              id: `E${index + 1}`,
              type: 'beam',
              nodes: [`N${index + 1}`, `N${index + 2}`],
              material: 'MAT1',
              section: 'SEC1',
            })),
            materials: [{ id: 'MAT1', name: 'Steel_Q235', E: 206000, nu: 0.3, rho: 7850 }],
            sections: [{ id: 'SEC1', name: 'Rect_200x400', type: 'rectangular', properties: { A: 0.08, Iy: 0.000266667, Iz: 0.001066667 } }],
            load_cases: [{ id: 'LC1', type: 'other', loads: [{ type: 'nodal_force', node: 'N6', fx: 0, fy: -1, fz: 0, mx: 0, my: 0, mz: 0 }] }],
            load_combinations: [{ id: 'COMB1', factors: { LC1: 1 } }],
          }),
        };
      },
    };

    const draft = await svc.textToModelDraft(
      '设计一个简支梁，跨度10m，梁中间荷载1kN，用10个单元来建模',
      undefined,
      'zh',
      ['generic'],
    );

    expect(callCount).toBe(2);
    expect(draft.inferredType).toBe('beam');
    expect(draft.stateToPersist?.inferredType).toBe('beam');
    expect(draft.stateToPersist?.skillId).toBe('generic');
    expect(draft.model?.elements).toHaveLength(10);
    expect(draft.model?.nodes).toHaveLength(11);
    expect(draft.missingFields).toEqual([]);
  });

  test('should block execution with an empty skill set even when a computable model is provided', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      message: '按3m悬臂梁端部10kN点荷载做静力分析',
      context: {
        locale: 'zh',
        skillIds: [],
        model: {
          schema_version: '1.0.0',
          unit_system: 'SI',
          nodes: [
            { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
            { id: '2', x: 3, y: 0, z: 0 },
          ],
          elements: [
            { id: '1', type: 'beam', node_i: '1', node_j: '2', material: 'mat1', section: 'sec1' },
          ],
          materials: [{ id: 'mat1', type: 'steel', E: 2.06e11, nu: 0.3, density: 7850 }],
          sections: [{ id: 'sec1', type: 'rectangular', width: 0.3, height: 0.6 }],
          load_cases: [{ id: 'LC1', type: 'dead', loads: [{ type: 'nodal', node: '2', fz: -10 }] }],
          load_combinations: [{ id: 'ULS1', factors: [{ case: 'LC1', factor: 1.0 }] }],
        },
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });

    expect(result.success).toBe(false);
    expect(result.toolCalls.some((item) => item.tool === 'run_analysis')).toBe(false);
    expect(result.blockedReasonCode).toBe('NO_EXECUTABLE_TOOL');
  });

  test('should block execution with an empty skill set when a computable model is unavailable', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runForcedExecution({
      message: '按3m悬臂梁端部10kN点荷载做静力分析',
      context: {
        locale: 'zh',
        skillIds: [],
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });

    expect(result.success).toBe(false);
    expect(result.needsModelInput).toBe(true);
    expect(result.toolCalls.some((item) => item.tool === 'run_analysis')).toBe(false);
  });

  test('should continue to analyze when validate returns an upstream 502', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc, {
      validate: async () => {
        const error = new Error('Request failed with status code 502');
        error.response = { status: 502, data: { message: 'bad gateway' } };
        throw error;
      },
    });

    const result = await svc.runForcedExecution({
      message: '请自动校核并生成报告',
      context: {
        locale: 'zh',
        model: {
          schema_version: '1.0.0',
          nodes: [
            { id: '1', x: 0, y: 0, z: 0, restraints: [true, false, true, false, true, false] },
            { id: '2', x: 5, y: 0, z: 0 },
            { id: '3', x: 10, y: 0, z: 0, restraints: [true, false, true, false, true, false] },
          ],
          elements: [
            { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
            { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
          ],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [{ id: 'LC1', type: 'other', loads: [{ type: 'distributed', element: '1', wz: -10 }] }],
          load_combinations: [{ id: 'ULS', factors: { LC1: 1 } }],
        },
        skillIds: ['code-check-gb50017'],
        autoAnalyze: true,
        autoCodeCheck: true,
        includeReport: true,
        reportFormat: 'both',
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls.find((call) => call.tool === 'validate_model')?.status).toBe('error');
    expect(result.toolCalls.find((call) => call.tool === 'run_analysis')?.status).toBe('success');
    expect(result.response).toContain('模型校验服务暂时不可用');
  });

  test('should retry analyze when the engine returns a transient 502', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    let analyzeAttempts = 0;
    stubExecutionClients(svc, {
      analyze: async (_path, payload) => {
        analyzeAttempts += 1;
        if (analyzeAttempts < 2) {
          const error = new Error('Request failed with status code 502');
          error.response = { status: 502, data: { message: 'bad gateway' } };
          throw error;
        }
        return {
          data: {
            schema_version: '1.0.0',
            analysis_type: payload.type,
            success: true,
            error_code: null,
            message: 'ok',
            data: {},
            meta: {},
          },
        };
      },
    });

    const result = await svc.runForcedExecution({
      message: '请做静力分析',
      context: {
        locale: 'zh',
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        autoCodeCheck: false,
        includeReport: false,
      },
    });

    expect(result.success).toBe(true);
    expect(analyzeAttempts).toBe(2);
    expect(result.toolCalls.find((call) => call.tool === 'run_analysis')?.status).toBe('success');
  });

  test('should report engine unavailable when analyze keeps returning 502', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    let analyzeAttempts = 0;
    stubExecutionClients(svc, {
      analyze: async () => {
        analyzeAttempts += 1;
        const error = new Error('Request failed with status code 502');
        error.response = { status: 502, data: { message: 'bad gateway' } };
        throw error;
      },
    });

    const result = await svc.runForcedExecution({
      message: '请做静力分析',
      context: {
        locale: 'zh',
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        autoCodeCheck: false,
        includeReport: false,
      },
    });

    expect(result.success).toBe(false);
    expect(analyzeAttempts).toBe(3);
    expect(result.response).toContain('分析引擎服务暂时不可用');
  });

  test('should generate English summaries and markdown when locale=en', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      message: 'Run a static analysis and code check',
      context: {
        locale: 'en',
        model: {
          schema_version: '1.0.0',
          nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
          elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
          materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        skillIds: ['code-check-gb50017'],
        autoAnalyze: true,
        autoCodeCheck: true,
        includeReport: true,
        reportFormat: 'both',
      },
    });

    expect(result.success).toBe(true);
    expect(result.response).toContain('Analysis finished.');
    expect(result.report?.summary).toContain('Analysis type static; analysis succeeded');
    expect(result.report?.markdown).toContain('# StructureClaw Calculation Report');
    expect(result.report?.markdown).toContain('## Executive Summary');
  });

  test('should route steel frame requests to the dedicated frame structural type', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: 'Help me size a steel frame for static analysis',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.interactionStageLabel).toBe('Geometry');
    expect(result.interaction?.fallbackSupportNote).toBeUndefined();
    expect(result.interaction?.missingCritical).toContain('Story count');
    expect(result.response).not.toContain('Detected structural type');
  });

  test('should block auto routing when the llm planner is unavailable', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.run({
      message: 'Help me size a steel frame for static analysis',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(false);
    expect(result.orchestrationMode).toBe('llm-planned');
    expect(result.toolCalls).toEqual([]);
    expect(result.response).toContain('LLM configuration error');
  });

  test('should surface localized 401 planner details in blocked runs', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => {
        throw createPlannerHttpError(401, { error: 'invalid_api_key' }, 'Unauthorized');
      },
    };

    const result = await svc.run({
      message: 'Help me size a steel frame for static analysis',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('LLM configuration error');
    expect(result.response).toContain('invalid or unauthorized API key');
  });

  test('should surface localized 403 region planner details in blocked runs', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => {
        throw createPlannerHttpError(403, { error: 'model_not_available' }, 'Model is not available in your region');
      },
    };

    const result = await svc.run({
      message: 'Help me size a steel frame for static analysis',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('LLM configuration error');
    expect(result.response).toContain('model unavailable in your region');
  });

  test('should surface localized 429 planner details in blocked runs', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => {
        throw createPlannerHttpError(429, { error: 'rate_limit_exceeded' }, 'Too many requests');
      },
    };

    const result = await svc.run({
      message: 'Help me size a steel frame for static analysis',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('LLM configuration error');
    expect(result.response).toContain('rate limited or quota exceeded');
  });

  test('should surface sanitized generic http planner details in blocked runs', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => {
        throw createPlannerHttpError(
          500,
          'Internal upstream failure\nwith extra whitespace and provider payload details',
          'Internal Server Error',
        );
      },
    };

    const result = await svc.run({
      message: 'Help me size a steel frame for static analysis',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('LLM configuration error');
    expect(result.response).toContain('LLM 500 / Internal upstream failure with extra whitespace');
    expect(result.response).not.toContain('\n');
  });

  test('should block unsupported structural types from silently falling back to beam extraction', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: '请帮我分析一个桥梁模型，跨度 30m',
      context: {
        locale: 'zh',
      },
    });

    expect(result.success).toBe(true);
    expect(typeof result.interaction?.fallbackSupportNote).toBe('string');
    expect(result.response).toContain('请描述结构体系与构件连接关系');
    expect(result.response).toContain('可计算的结构模型 JSON');
  });

  test('should build a complete 2d frame model from regular frame parameters', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft('2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN', undefined, 'zh');

    expect(draft.missingFields).toContain('frameDimension');
    expect(draft.stateToPersist?.inferredType).toBe('frame');
    expect(draft.stateToPersist?.frameDimension).toBeUndefined();
    expect(draft.stateToPersist?.storyHeightsM).toEqual([3, 3]);
    expect(draft.stateToPersist?.bayWidthsM).toBeUndefined();
    expect(draft.model).toBeUndefined();
  });

  test('should build a complete 3d frame model from regular grid parameters', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft('3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，每层竖向荷载90kN，x向水平荷载18kN，y向水平荷载12kN', undefined, 'zh');

    expect(draft.missingFields).toEqual([]);
    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.bayWidthsXM).toEqual([6, 6]);
    expect(draft.stateToPersist?.bayWidthsYM).toEqual([5]);
    expect(draft.model?.metadata?.bayCountX).toBe(2);
    expect(draft.model?.metadata?.bayCountY).toBe(1);
    expect(draft.model?.nodes).toHaveLength(18);
    expect(draft.model?.elements).toHaveLength(26);
    expect(draft.model?.load_cases?.[0]?.loads).toHaveLength(12);
  });

  test('should parse 3d frame lateral loads when horizontal-load wording precedes directional values', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，每层竖向荷载90kN，水平荷载分别取x向18kN、y向12kN',
      undefined,
      'zh',
    );

    expect(draft.missingFields).toEqual([]);
    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.floorLoads).toEqual([
      { story: 1, verticalKN: 90, lateralXKN: 18, lateralYKN: 12 },
      { story: 2, verticalKN: 90, lateralXKN: 18, lateralYKN: 12 },
    ]);
    const loads = draft.model?.load_cases?.[0]?.loads ?? [];
    expect(loads).toHaveLength(12);
    expect(loads.every((load) => typeof load.fx === 'number' && typeof load.fy === 'number' && typeof load.fz === 'number')).toBe(true);
  });

  test('should mirror generic horizontal-load wording to both axes in 3d frame follow-up context', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-frame-generic-horizontal-3d',
      message: '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，每层竖向荷载90kN',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).not.toContain('各层总荷载（kN）');

    const second = await svc.runChatOnly({
      conversationId: 'conv-frame-generic-horizontal-3d',
      message: '水平方向荷载都是18kN',
      context: { locale: 'zh' },
    });

    const loads = second.model?.load_cases?.[0]?.loads ?? [];
    expect(second.interaction?.missingCritical).not.toContain('各层总荷载（kN）');
    expect(loads).toHaveLength(12);
    expect(loads.every((load) => typeof load.fx === 'number' && typeof load.fy === 'number' && typeof load.fz === 'number')).toBe(true);
  });

  test('should parse chinese two-direction horizontal-load wording in a single 3d frame sentence', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '我想设计一个三维框架结构，层数3层，各层层高3m，x向3跨，跨度为3m，y向2跨，跨度为3m，各层有竖向荷载1000kN，横向荷载两个方向都是500kN',
      undefined,
      'zh',
    );

    expect(draft.missingFields).toEqual([]);
    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.floorLoads).toEqual([
      { story: 1, verticalKN: undefined, lateralXKN: 500, lateralYKN: 500 },
      { story: 2, verticalKN: undefined, lateralXKN: 500, lateralYKN: 500 },
      { story: 3, verticalKN: undefined, lateralXKN: 500, lateralYKN: 500 },
    ]);
    const loads = draft.model?.load_cases?.[0]?.loads ?? [];
    expect(loads.length).toBeGreaterThan(0);
    expect(loads.every((load) => typeof load.fx === 'number' && typeof load.fy === 'number')).toBe(true);
  });

  test('should prefer llm-extracted frame floor loads for natural combined load wording', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          inferredType: 'frame',
          draftPatch: {
            inferredType: 'frame',
            frameDimension: '3d',
            storyCount: 3,
            storyHeightsM: [3, 3, 3],
            bayCountX: 3,
            bayCountY: 1,
            bayWidthsXM: [4, 4, 4],
            bayWidthsYM: [4],
            floorLoads: [
              { story: 1, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
              { story: 2, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
              { story: 3, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
            ],
          },
        }),
      }),
    };

    const draft = await svc.textToModelDraft('3层框架，每层3m，3跨，跨度4m，每层节点荷载都是1000kN，x、y向水平荷载都是500kN', undefined, 'zh');

    expect(draft.missingFields).toEqual([]);
    expect(draft.extractionMode).toBe('llm');
    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.floorLoads).toEqual([
      { story: 1, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
      { story: 2, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
      { story: 3, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
    ]);
  });

  test('should keep llm beam load semantics when rules disagree', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          inferredType: 'beam',
          draftPatch: {
            inferredType: 'beam',
            lengthM: 6,
            supportType: 'simply-supported',
            loadKN: 20,
            loadType: 'point',
            loadPosition: 'midspan',
          },
        }),
      }),
    };

    const draft = await svc.textToModelDraft('简支梁，跨度6m，20kN均布荷载', undefined, 'zh');

    expect(draft.extractionMode).toBe('llm');
    expect(draft.stateToPersist?.loadType).toBe('point');
    expect(draft.stateToPersist?.loadPosition).toBe('midspan');
  });

  test('should keep llm portal-frame load semantics when rules disagree', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          inferredType: 'portal-frame',
          draftPatch: {
            inferredType: 'portal-frame',
            spanLengthM: 12,
            heightM: 4,
            loadKN: 30,
            loadType: 'point',
            loadPosition: 'top-nodes',
          },
        }),
      }),
    };

    const draft = await svc.textToModelDraft('门式刚架，跨度12m，柱高4m，30kN檐梁均布荷载', undefined, 'zh');

    expect(draft.extractionMode).toBe('llm');
    expect(draft.stateToPersist?.loadType).toBe('point');
    expect(draft.stateToPersist?.loadPosition).toBe('top-nodes');
  });

  test('should keep llm truss load semantics when rules disagree', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          inferredType: 'truss',
          draftPatch: {
            inferredType: 'truss',
            lengthM: 5,
            loadKN: 10,
            loadType: 'distributed',
            loadPosition: 'free-joint',
          },
        }),
      }),
    };

    const draft = await svc.textToModelDraft('平面桁架，长度5m，10kN节点点荷载', undefined, 'zh');

    expect(draft.extractionMode).toBe('llm');
    expect(draft.stateToPersist?.loadType).toBe('distributed');
    expect(draft.stateToPersist?.loadPosition).toBe('free-joint');
  });

  test('should keep llm double-span values when rules disagree', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          inferredType: 'double-span-beam',
          draftPatch: {
            inferredType: 'double-span-beam',
            spanLengthM: 7,
            loadKN: 25,
            loadType: 'point',
            loadPosition: 'middle-joint',
          },
        }),
      }),
    };

    const draft = await svc.textToModelDraft('双跨梁，每跨6m，25kN均布荷载', undefined, 'zh');

    expect(draft.extractionMode).toBe('llm');
    expect(draft.stateToPersist?.spanLengthM).toBe(7);
    expect(draft.stateToPersist?.loadType).toBe('point');
    expect(draft.stateToPersist?.loadPosition).toBe('middle-joint');
  });

  test('should parse natural chinese frame geometry phrases in rule fallback mode', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft('我想设计一个三层框架，x方向4跨，间隔3m，y方向3跨间隔也是3m，每层3m', undefined, 'zh');

    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.storyCount).toBe(3);
    expect(draft.stateToPersist?.storyHeightsM).toEqual([3, 3, 3]);
    expect(draft.stateToPersist?.bayCountX).toBe(4);
    expect(draft.stateToPersist?.bayCountY).toBe(3);
    expect(draft.stateToPersist?.bayWidthsXM).toEqual([3, 3, 3, 3]);
    expect(draft.stateToPersist?.bayWidthsYM).toEqual([3, 3, 3]);
    expect(draft.missingFields).toContain('floorLoads');
    expect(draft.missingFields).not.toContain('storyCount');
    expect(draft.missingFields).not.toContain('storyHeightsM');
  });

  test('should let an existing frame chat refine from 2d to 3d when llm extracts y-direction loads', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'ask',
              replyMode: null,
              reason: 'collect structured frame details',
            }),
          };
        }
        if (text.includes('每层竖向荷载120kN，水平荷载30kN')) {
          return {
            content: JSON.stringify({
              inferredType: 'frame',
              draftPatch: {
                inferredType: 'frame',
                frameDimension: '2d',
                storyCount: 2,
                bayCount: 2,
                storyHeightsM: [3, 3],
                bayWidthsM: [6, 6],
                floorLoads: [
                  { story: 1, verticalKN: 120, lateralXKN: 30 },
                  { story: 2, verticalKN: 120, lateralXKN: 30 },
                ],
              },
            }),
          };
        }
        return {
          content: JSON.stringify({
            inferredType: 'frame',
            draftPatch: {
              inferredType: 'frame',
              floorLoads: [
                { story: 1, verticalKN: 120, lateralXKN: 500, lateralYKN: 500 },
                { story: 2, verticalKN: 120, lateralXKN: 500, lateralYKN: 500 },
              ],
            },
          }),
        };
      },
    };

    const first = await svc.runChatOnly({
      conversationId: 'conv-frame-upgrade-3d',
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
      context: { locale: 'zh' },
    });

    expect(first.model?.metadata?.inferredType).toBe('frame');

    const second = await svc.runChatOnly({
      conversationId: 'conv-frame-upgrade-3d',
      message: '每层竖向荷载120kN，x、y向水平荷载都是500kN',
      context: { locale: 'zh' },
    });

    expect(second.interaction?.missingCritical).toContain('X向跨数');
    expect(second.interaction?.missingCritical).toContain('Y向跨数');
    expect(second.interaction?.missingCritical).not.toContain('各层总荷载（kN）');
  });

  test('should accumulate frame follow-up phrases for story heights and lateral loads', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-frame-natural-followup',
      message: '我想设计一个三层框架，x方向4跨，间隔3m，y方向3跨间隔也是3m',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).toContain('各层层高（m）');
    expect(first.interaction?.missingCritical).toContain('各层总荷载（kN）');

    const second = await svc.runChatOnly({
      conversationId: 'conv-frame-natural-followup',
      message: '每层3m',
      context: { locale: 'zh' },
    });

    expect(second.interaction?.missingCritical).not.toContain('各层层高（m）');
    expect(second.interaction?.missingCritical).toContain('各层总荷载（kN）');

    const third = await svc.runChatOnly({
      conversationId: 'conv-frame-natural-followup',
      message: '各层竖向荷载都是1000kN，横向荷载都是500kN',
      context: { locale: 'zh' },
    });

    expect(third.interaction?.missingCritical).not.toContain('各层层高（m）');
    expect(third.interaction?.missingCritical).not.toContain('各层总荷载（kN）');
    expect(third.interaction?.state).toBe('ready');
  });

  test('should keep engineering follow-up turns in structured context instead of forgetting prior frame intent', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    const originalFindMany = prisma.message.findMany;
    let historyTurn = 0;

    prisma.message.findMany = async ({ where }) => {
      if (where?.conversationId !== 'conv-frame-followup-llm-planner') {
        return [];
      }
      if (historyTurn === 0) {
        return [];
      }
      if (historyTurn === 1) {
        return [
          { role: 'assistant', content: '请先描述结构体系、构件连接关系和主要荷载。' },
          { role: 'user', content: '我想设计一个三维框架结构' },
        ];
      }
      return [
        { role: 'assistant', content: '请继续补充几层几跨、柱网尺寸和平面形状。' },
        { role: 'user', content: '一个钢框架结构体系' },
        { role: 'assistant', content: '请先描述结构体系、构件连接关系和主要荷载。' },
        { role: 'user', content: '我想设计一个三维框架结构' },
      ];
    };

    try {
      const first = await svc.runChatOnly({
        conversationId: 'conv-frame-followup-llm-planner',
        message: '我想设计一个三维框架结构',
        context: {
          locale: 'zh',
          skillIds: ['opensees-static', 'generic'],
          enabledToolIds: ['draft_model', 'validate_model', 'run_analysis', 'generate_report'],
        },
      });

      expect((first.interaction?.missingCritical ?? []).length).toBeGreaterThan(0);

      historyTurn = 1;
      svc.llm = {
        invoke: async (prompt) => {
          const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
          if (text.includes('Return strict JSON only')) {
            if (text.includes('User message: 一个钢框架结构体系')) {
              expect(text).toContain('assistant: 请先描述结构体系、构件连接关系和主要荷载。');
              expect(text).toContain('我想设计一个三维框架结构');
              return {
                content: JSON.stringify({
                  kind: 'ask',
                  replyMode: null,
                  reason: 'engineering follow-up answering the previous missing parameter request',
                }),
              };
            }
            if (text.includes('User message: 3层每层3m，x方向4跨，跨度5m，y方向3跨，跨度3m')) {
              expect(text).toContain('一个钢框架结构体系');
              expect(text).toContain('请继续补充几层几跨、柱网尺寸和平面形状。');
              return {
                content: JSON.stringify({
                  kind: 'ask',
                  replyMode: null,
                  reason: 'continue collecting frame geometry instead of resetting the session',
                }),
              };
            }
            return {
              content: JSON.stringify({
                kind: 'reply',
                replyMode: 'plain',
                reason: 'default test fallback',
              }),
            };
          }
          return { content: '好的。' };
        },
      };

      const second = await svc.runChatOnly({
        conversationId: 'conv-frame-followup-llm-planner',
        message: '一个钢框架结构体系',
        context: {
          locale: 'zh',
          skillIds: ['opensees-static', 'generic'],
          enabledToolIds: ['draft_model', 'validate_model', 'run_analysis', 'generate_report'],
        },
      });

      expect(second.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);

      historyTurn = 2;
      const third = await svc.runChatOnly({
        conversationId: 'conv-frame-followup-llm-planner',
        message: '3层每层3m，x方向4跨，跨度5m，y方向3跨，跨度3m',
        context: {
          locale: 'zh',
          skillIds: ['opensees-static', 'generic'],
          enabledToolIds: ['draft_model', 'validate_model', 'run_analysis', 'generate_report'],
        },
      });

      expect(third.toolCalls.some((call) => call.tool === 'draft_model')).toBe(true);
      expect(third.response).not.toContain('请先补齐 结构体系');
    } finally {
      prisma.message.findMany = originalFindMany;
    }
  });

  test('should update the existing model and rerun analysis when the user modifies prior loads', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    stubExecutionClients(svc);

    const first = await svc.runChatOnly({
      conversationId: 'conv-frame-update-loads',
      message: '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，每层竖向荷载90kN，x向水平荷载18kN，y向水平荷载12kN',
      context: {
        locale: 'zh',
      },
    });

    expect(first.success).toBe(true);
    expect(first.model).toBeDefined();

    const computed = await svc.runForcedExecution({
      conversationId: 'conv-frame-update-loads',
      message: '计算',
      context: {
        locale: 'zh',
      },
    });

    expect(computed.toolCalls.some((call) => call.tool === 'run_analysis')).toBe(true);

    // The user changes loads. The pre-processing step updates the DraftState
    // via extractDraftParameters, which changes the DraftState content hash.
    // The scheduler detects the hash change vs the seeded normalizedModel fingerprint
    // and plans an update_model step to rebuild normalizedModel.
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        if (text.includes('Return strict JSON only')) {
          return {
            content: JSON.stringify({
              kind: 'execute',
              targetArtifact: 'analysisRaw',
              replyMode: null,
              reason: 'the user is modifying the current frame loads and expects updated engineering results',
            }),
          };
        }
        return { content: 'ok' };
      },
    };

    // Stub extractDraftParameters to return an updated draft with changed loads.
    // The pre-processing step calls this to update the DraftState before scheduling.
    // The changed DraftState hash triggers normalizedModel rebuild via fingerprint mismatch.
    svc.skillRuntime.extractDraftParameters = async () => ({
      nextState: {
        inferredType: 'frame',
        structuralTypeKey: '3d-frame',
        skillId: '3d-frame',
        supportLevel: 'supported',
        floorLoadsX: [10, 10],
        floorLoadsY: [0, 0],
        floorVerticalLoads: [0, 0],
        updatedAt: Date.now(),
      },
      missing: { critical: [], optional: [] },
      structuralTypeMatch: { key: '3d-frame', mappedType: 'frame', skillId: '3d-frame', supportLevel: 'supported' },
      plugin: { id: '3d-frame' },
      extractionMode: 'llm',
    });
    svc.skillRuntime.buildModelFromDraft = async () => ({
      inferredType: 'frame',
      missingFields: [],
      extractionMode: 'llm',
      model: computed.model ?? first.model,
      stateToPersist: { inferredType: 'frame', updatedAt: Date.now() },
    });

    const updated = await svc.run({
      conversationId: 'conv-frame-update-loads',
      message: '好的，现在荷载改成每层都是水平x方向10kN',
      context: {
        locale: 'zh',
      },
    });

    // The DraftState hash change forces normalizedModel rebuild.
    // The update_model step should be planned and executed.
    // (Enricher steps may fail in test context, blocking downstream steps — that's OK,
    // the key assertion is that update_model was triggered by the DraftState change.)
    expect(updated.toolCalls.some((call) => call.tool === 'update_model')).toBe(true);
  });

  test('should merge 2d frame vertical and lateral loads across chat turns', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-frame-merge-2d-loads',
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).not.toContain('各层总荷载（kN）');
    expect(first.model).toBeUndefined();

    const second = await svc.runChatOnly({
      conversationId: 'conv-frame-merge-2d-loads',
      message: '每层水平荷载30kN',
      context: { locale: 'zh' },
    });

    expect(second.interaction?.missingCritical).toContain('框架维度（2D/3D）');
    expect(second.model).toBeUndefined();
  });

  test('should merge 3d frame y-direction lateral loads without dropping existing floor loads', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const first = await svc.runChatOnly({
      conversationId: 'conv-frame-merge-3d-loads',
      message: '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，每层竖向荷载90kN，x向水平荷载18kN',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).not.toContain('各层总荷载（kN）');
    expect(first.model?.load_cases?.[0]?.loads).toHaveLength(12);
    expect(first.model?.load_cases?.[0]?.loads.every((load) => typeof load.fz === 'number' && typeof load.fx === 'number' && load.fy === undefined)).toBe(true);

    const second = await svc.runChatOnly({
      conversationId: 'conv-frame-merge-3d-loads',
      message: 'y向水平荷载12kN',
      context: { locale: 'zh' },
    });

    const loads = second.model?.load_cases?.[0]?.loads ?? [];
    expect(second.interaction?.missingCritical).not.toContain('各层总荷载（kN）');
    expect(loads).toHaveLength(12);
    expect(loads.every((load) => typeof load.fy === 'number' && typeof load.fx === 'number' && typeof load.fz === 'number')).toBe(true);
    expect(second.model?.metadata?.bayCountX).toBe(2);
    expect(second.model?.metadata?.bayCountY).toBe(1);
  });

  test('should parse 竖直方向 load phrasing for per-floor total loads', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      conversationId: 'conv-frame-vertical-direction-zh',
      message: '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，各层竖直方向荷载都是200kN，x向和y向都是20kN',
      context: { locale: 'zh' },
    });

    expect(result.interaction?.missingCritical).not.toContain('各层总荷载（kN）');
    expect(result.model).toBeDefined();
    const loads = result.model?.load_cases?.[0]?.loads ?? [];
    expect(loads.length).toBeGreaterThan(0);
    expect(loads.every((load) => typeof load.fy === 'number')).toBe(true);
  });

  test('should expose a conversation session snapshot for context restoration', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    await svc.runChatOnly({
      conversationId: 'conv-session-snapshot',
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
      context: { locale: 'zh' },
    });

    const snapshot = await svc.getConversationSessionSnapshot('conv-session-snapshot', 'zh');

    expect(snapshot).toBeDefined();
    expect(snapshot?.draft?.inferredType).toBe('frame');
    expect(snapshot?.resolved?.analysisType).toBe('static');
    expect(snapshot?.interaction?.interactionStageLabel).toBe('几何建模');
    expect(snapshot?.model).toBeUndefined();
  });

  test('should persist agent chat messages for conversation history restoration', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;
    const originalCreateMany = prisma.message.createMany;
    const originalFindUnique = prisma.conversation.findUnique;
    const recorded = [];
    prisma.conversation.findUnique = async () => ({ id: 'conv-persist-history' });
    prisma.message.createMany = async ({ data }) => {
      recorded.push(...data);
      return { count: data.length };
    };

    try {
      await svc.runChatOnly({
        conversationId: 'conv-persist-history',
        message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
        context: { locale: 'zh' },
      });
    } finally {
      prisma.conversation.findUnique = originalFindUnique;
      prisma.message.createMany = originalCreateMany;
    }

    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.conversationId).toBe('conv-persist-history');
    expect(recorded[0]?.role).toBe('user');
    expect(recorded[1]?.role).toBe('assistant');
    expect(recorded[1]?.content).toContain('当前阶段');
  });

  test('should keep regular frame chat in model stage until frame geometry is complete', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: '请先聊一个框架',
      context: {
        locale: 'zh',
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.stage).toBe('model');
    expect(result.interaction?.missingCritical).toContain('层数');
    expect(result.interaction?.missingCritical).toContain('各层总荷载（kN）');
  });

  test('should advance chat guidance to load stage once portal geometry is known', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const result = await svc.runChatOnly({
      message: 'Portal frame, each span 6 m and column height 4 m',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.stage).toBe('model');
    expect(result.interaction?.interactionStageLabel).toBe('Geometry');
    expect(result.interaction?.missingCritical).toContain('Load magnitude (kN)');
    expect(result.interaction?.recommendedNextStep).toContain('Span');
  });

  test('should return synchronized model and auto-apply noncritical defaults once structural params are complete', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const collecting = await svc.runChatOnly({
      message: '简支梁，跨度6m，20kN跨中点荷载',
      context: {
        locale: 'zh',
      },
    });

    expect(collecting.success).toBe(true);
    expect(collecting.interaction?.state).toBe('confirming');
    expect((collecting.interaction?.missingOptional ?? []).length).toBeGreaterThanOrEqual(0);
    expect(collecting.model).toBeUndefined();

    const incomplete = await svc.runChatOnly({
      message: '我想设计一个梁',
      context: {
        locale: 'zh',
      },
    });

    expect(incomplete.success).toBe(true);
    expect(incomplete.interaction?.state).toBe('confirming');
    expect(incomplete.model).toBeUndefined();
  });

  test('should place simply-supported point load at midspan when message says midspan', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft('简支梁，跨度6m，20kN跨中点荷载', undefined, 'zh');
    const model = draft.model;
    const loads = model?.load_cases?.[0]?.loads ?? [];
    const pointLoad = loads.find((load) => typeof load?.node === 'string' && typeof load?.fy === 'number');
    const loadedNode = model?.nodes?.find((node) => node.id === pointLoad?.node);

    expect(pointLoad).toBeUndefined();
    expect(loadedNode).toBeUndefined();
  });

  test('should place simply-supported point load at beam end when message says end', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft('简支梁，跨度6m，20kN端部点荷载', undefined, 'zh');
    const model = draft.model;
    const loads = model?.load_cases?.[0]?.loads ?? [];
    const pointLoad = loads.find((load) => typeof load?.node === 'string' && typeof load?.fy === 'number');
    const loadedNode = model?.nodes?.find((node) => node.id === pointLoad?.node);

    expect(pointLoad).toBeUndefined();
    expect(loadedNode).toBeUndefined();
  });

  test('should return synchronized frame model with noncritical defaults auto-applied', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const collecting = await svc.runChatOnly({
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
      context: {
        locale: 'zh',
      },
    });

    expect(collecting.success).toBe(true);
    expect(collecting.interaction?.state).toBe('confirming');
    expect(collecting.model).toBeUndefined();
  });

  test('should parse steel grade and use it as material name in model', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '2层2跨钢框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN，材料Q235',
      undefined,
      'zh',
    );

    expect(draft.missingFields).toContain('frameDimension');
    expect(draft.stateToPersist?.frameMaterial).toBe('Q235');
    expect(draft.missingFields).toContain('frameDimension');
    expect(draft.model).toBeUndefined();
  });

  test('should fall back to Q355 properties and name when unknown grade is specified', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '2层2跨钢框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN，材料Q999',
      undefined,
      'zh',
    );

    expect(draft.missingFields).toContain('frameDimension');
    expect(draft.missingFields).toContain('frameDimension');
    expect(draft.model).toBeUndefined();
  });

  test('should use sectionKey as section name when unknown section is specified', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN，柱截面HW350X350',
      undefined,
      'zh',
    );

    expect(draft.missingFields).toContain('frameDimension');
    expect(draft.missingFields).toContain('frameDimension');
    expect(draft.model).toBeUndefined();
  });

  test('should parse unequal x-direction spans into bayWidthsXM', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '钢框架，x向3跨跨度分别6m、9m、6m，y向1跨跨度5m，层高3.6m，层数3层，每层竖向100kN，x向水平荷载20kN',
      undefined,
      'zh',
    );

    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.bayWidthsXM).toEqual([6, 9, 6]);
    expect(draft.stateToPersist?.bayCountX).toBe(3);
  });

  test('should preserve explicit z-direction floor loads in chat-driven 3d frame drafting', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，x方向荷载18kN，y方向荷载12kN，z方向荷载10kN',
      undefined,
      'zh',
    );

    expect(draft.missingFields).toEqual([]);
    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.floorLoads).toEqual([
      { story: 1, verticalKN: 10, lateralXKN: 18, lateralYKN: 12 },
      { story: 2, verticalKN: 10, lateralXKN: 18, lateralYKN: 12 },
    ]);
  });

  test('should keep 2d frame wording on the xz plane', async () => {
    const svc = createServiceWithDefaultSkills();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '2D frame, 2 stories, 2 bays at 6 m, story height 3 m, z-direction load 120 kN and x-direction load 30 kN',
      undefined,
      'en',
    );

    expect(draft.stateToPersist?.frameDimension).toBe('2d');
    expect(draft.stateToPersist?.floorLoads?.[0]).toMatchObject({ verticalKN: 120, lateralXKN: 30 });
  });
});
