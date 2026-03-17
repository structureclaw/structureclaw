import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import { AgentService } from '../dist/services/agent.js';
import { prisma } from '../dist/utils/database.js';
import { redis } from '../dist/utils/redis.js';

describe('AgentService orchestration', () => {
  test('should execute analyze -> code-check -> report closed loop', async () => {
    const svc = new AgentService();
    svc.llm = null;
    svc.engineClient.post = async (path, payload) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/analyze') {
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
      }
      if (path === '/code-check') {
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            details: [],
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请静力分析并规范校核',
      mode: 'execute',
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
        designCode: 'GB50017',
        includeReport: true,
        reportFormat: 'both',
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'analyze')).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'code-check')).toBe(true);
    expect(result.toolCalls.some((c) => c.tool === 'report')).toBe(true);
    expect(result.codeCheck?.code).toBe('GB50017');
    expect(typeof result.report?.markdown).toBe('string');
  });

  test('should clear stored conversation sessions', async () => {
    const svc = new AgentService();
    const deletedKeys = [];
    redis.del = async (...keys) => {
      deletedKeys.push(...keys);
      return keys.length;
    };

    await svc.clearConversationSession('conv-cleanup');

    expect(deletedKeys).toEqual([
      'agent:interaction-session:conv-cleanup',
      'agent:draft-state:conv-cleanup',
    ]);
  });

  test('should pass engineId through validate analyze and code-check calls', async () => {
    const svc = new AgentService();
    svc.llm = null;
    const calls = [];
    svc.engineClient.post = async (path, payload) => {
      calls.push({ path, payload });
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0', meta: { engineId: payload.engineId } } };
      }
      if (path === '/analyze') {
        return {
          data: {
            schema_version: '1.0.0',
            analysis_type: payload.type,
            success: true,
            error_code: null,
            message: 'ok',
            data: {},
            meta: { engineId: payload.engineId, selectionMode: 'manual' },
          },
        };
      }
      if (path === '/code-check') {
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            details: [],
            meta: { engineId: payload.engineId },
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请静力分析并规范校核',
      mode: 'execute',
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
        autoAnalyze: true,
        autoCodeCheck: true,
        designCode: 'GB50017',
      },
    });

    expect(result.success).toBe(true);
    expect(calls.find((item) => item.path === '/validate')?.payload.engineId).toBe('builtin-opensees');
    expect(calls.find((item) => item.path === '/analyze')?.payload.engineId).toBe('builtin-opensees');
    expect(calls.find((item) => item.path === '/code-check')?.payload.engineId).toBe('builtin-opensees');
  });

  test('should fail when code-check fails in closed loop', async () => {
    const svc = new AgentService();
    svc.llm = null;
    svc.engineClient.post = async (path, payload) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/analyze') {
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
      if (path === '/code-check') {
        const error = new Error('code check failed');
        error.response = { data: { errorCode: 'CODE_CHECK_EXECUTION_FAILED' } };
        throw error;
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请静力分析并规范校核',
      mode: 'execute',
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
        designCode: 'GB50017',
      },
    });

    expect(result.success).toBe(false);
    const codeCheckCall = result.toolCalls.find((c) => c.tool === 'code-check');
    expect(codeCheckCall?.status).toBe('error');
    expect(codeCheckCall?.errorCode).toBe('CODE_CHECK_EXECUTION_FAILED');
  });

  test('should export report artifacts to files when reportOutput=file', async () => {
    const svc = new AgentService();
    svc.llm = null;
    svc.engineClient.post = async (path, payload) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/analyze') {
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
      if (path === '/code-check') {
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            details: [],
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请静力分析并规范校核并导出报告',
      mode: 'execute',
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
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: 'Analyze a portal frame',
      mode: 'execute',
      conversationId: 'conv-en',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('Please confirm the following parameters first');
    expect(result.clarification?.missingFields).toContain('Span length per bay for the portal frame or double-span beam (m)');
    expect(result.clarification?.missingFields).toContain('Portal-frame column height (m)');
  });

  test('should merge rule-extracted numeric follow-up when llm extraction is partial', async () => {
    const svc = new AgentService();
    svc.llm = null;
    svc.tryLlmExtract = async () => ({ inferredType: 'beam' });

    const result = await svc.run({
      conversationId: 'conv-rule-fallback-zh',
      message: '跨度10m',
      mode: 'chat',
      context: {
        locale: 'zh',
        providedValues: {
          inferredType: 'beam',
        },
      },
    });

    expect(result.interaction?.detectedScenario).toBe('beam');
    expect(result.interaction?.missingCritical).not.toContain('跨度/长度（m）');
    expect(result.interaction?.missingCritical).toContain('支座/边界条件（悬臂/简支/两端固结/固铰）');
    expect(result.interaction?.conversationStage).toBe('几何建模');
  });

  test('should not repeat beam span after a follow-up value in chat mode', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-chat-beam-span-zh',
      message: '我想设计一个梁',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(first.interaction?.missingCritical).toContain('跨度/长度（m）');

    const second = await svc.run({
      conversationId: 'conv-chat-beam-span-zh',
      message: '跨度10m',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(second.interaction?.detectedScenario).toBe('beam');
    expect(second.interaction?.missingCritical).not.toContain('跨度/长度（m）');
    expect(second.interaction?.missingCritical).toContain('支座/边界条件（悬臂/简支/两端固结/固铰）');
    expect(second.interaction?.conversationStage).toBe('几何建模');
  });

  test('should not ask for the same span again after a follow-up value in chat mode', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-chat-span-zh',
      message: '先聊需求，我要做一个门式刚架',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(first.interaction?.missingCritical).toContain('门式刚架或双跨每跨跨度（m）');

    const second = await svc.run({
      conversationId: 'conv-chat-span-zh',
      message: '跨度10m',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(second.interaction?.detectedScenario).toBe('portal-frame');
    expect(second.interaction?.missingCritical).not.toContain('门式刚架或双跨每跨跨度（m）');
    expect(second.interaction?.missingCritical).toContain('门式刚架柱高（m）');
    expect(second.interaction?.missingCritical).toContain('荷载大小（kN）');
    expect(second.response).not.toContain('每跨跨度');
  });

  test('should shrink English missing fields after a span-only follow-up', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-chat-span-en',
      message: 'Discuss a portal frame first',
      mode: 'chat',
      context: {
        locale: 'en',
      },
    });

    expect(first.interaction?.missingCritical).toContain('Span length per bay for the portal frame or double-span beam (m)');

    const second = await svc.run({
      conversationId: 'conv-chat-span-en',
      message: 'span 10m',
      mode: 'chat',
      context: {
        locale: 'en',
      },
    });

    expect(second.interaction?.detectedScenario).toBe('portal-frame');
    expect(second.interaction?.missingCritical).not.toContain('Span length per bay for the portal frame or double-span beam (m)');
    expect(second.interaction?.missingCritical).toContain('Portal-frame column height (m)');
    expect(second.interaction?.missingCritical).toContain('Load magnitude (kN)');
    expect(second.interaction?.missingCritical).toContain('Load type (point / distributed)');
    expect(second.interaction?.missingCritical).toContain('Load position (based on the current template)');
    expect(second.response).not.toContain('Span per bay');
  });

  test('should shrink beam load detail prompts after type and position are provided', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-chat-load-detail-zh',
      message: '我想设计一个简支梁，跨度10m',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(first.interaction?.missingCritical).toContain('荷载大小（kN）');
    expect(first.interaction?.missingCritical).toContain('荷载形式（点荷载/均布荷载）');
    expect(first.interaction?.missingCritical).toContain('荷载位置（按当前结构模板）');

    const second = await svc.run({
      conversationId: 'conv-chat-load-detail-zh',
      message: '20kN均布荷载，全跨布置',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(second.interaction?.detectedScenario).toBe('beam');
    expect(second.interaction?.missingCritical).not.toContain('荷载大小（kN）');
    expect(second.interaction?.missingCritical).not.toContain('荷载形式（点荷载/均布荷载）');
    expect(second.interaction?.missingCritical).not.toContain('荷载位置（按当前结构模板）');
    expect(Array.isArray(second.interaction?.missingOptional)).toBe(true);
  });


  test('should not synthesize template model in no-skill mode when llm is unavailable', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const draft = await svc.textToModelDraft('生成一个跨度10m的简支梁，荷载在4m处，一个集中荷载10kN', undefined, 'zh', []);

    expect(draft.model).toBeUndefined();
    expect(draft.stateToPersist?.inferredType).toBe('unknown');
    expect(draft.missingFields.length).toBeGreaterThan(0);
  });

  test('should stay in collecting state in no-skill mode when llm is unavailable', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: '我希望生成一个跨度10m的简支梁，荷载在4m处，一个集中荷载10kN',
      mode: 'chat',
      context: {
        locale: 'zh',
        skillIds: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsModelInput).toBe(true);
    expect(result.interaction?.state).toBe('confirming');
    expect((result.interaction?.missingCritical || []).length).toBeGreaterThan(0);
    expect(result.model).toBeUndefined();
  });

  test('should keep no-skill chat generic even when message contains template keywords', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: '门式刚架，跨度10m，10kN集中荷载在4m处',
      mode: 'chat',
      context: {
        locale: 'zh',
        skillIds: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.needsModelInput).toBe(true);
    expect(result.interaction?.state).toBe('confirming');
    expect(result.interaction?.detectedScenario).not.toBe('beam');
    expect(result.model).toBeUndefined();
  });

  test('should keep inferredType unknown in no-skill mode even when llm extraction suggests template type', async () => {
    const svc = new AgentService();
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

  test('should ignore template support fields in no-skill state even when llm extraction returns them', async () => {
    const svc = new AgentService();
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

  test('should ignore categorical loadPosition in no-skill state', async () => {
    const svc = new AgentService();
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

  test('should ignore categorical loadType in no-skill state', async () => {
    const svc = new AgentService();
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

  test('should strip skill metadata from no-skill state normalization', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '给我一个可计算结构模型',
      {
        inferredType: 'frame',
        skillId: 'frame',
        scenarioKey: 'frame',
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
    expect(draft.stateToPersist?.scenarioKey).toBeUndefined();
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

  test('should sanitize providedValues in no-skill mode without scenario carry-over', async () => {
    const svc = new AgentService();
    svc.llm = null;
    const conversationId = 'conv-no-skill-provided-values-sanitize';
    await svc.clearConversationSession(conversationId);

    await svc.run({
      message: '继续',
      mode: 'chat',
      conversationId,
      context: {
        locale: 'zh',
        skillIds: [],
        providedValues: {
          inferredType: 'frame',
          skillId: 'frame',
          scenarioKey: 'frame',
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

    expect(snapshot?.draft.inferredType).toBe('unknown');
    expect(snapshot?.draft.skillId).toBeUndefined();
    expect(snapshot?.draft.scenarioKey).toBeUndefined();
    expect(snapshot?.draft.supportLevel).toBeUndefined();
    expect(snapshot?.draft.supportNote).toBeUndefined();
    expect(snapshot?.draft.lengthM).toBeUndefined();
    expect(snapshot?.draft.loadKN).toBeUndefined();
    expect(snapshot?.draft.loadType).toBeUndefined();
    expect(snapshot?.draft.loadPosition).toBeUndefined();
    expect(snapshot?.draft.loadPositionM).toBeUndefined();

    await svc.clearConversationSession(conversationId);
  });

  test('should clear scenario carry-over when switching an existing conversation to no-skill mode', async () => {
    const svc = new AgentService();
    svc.llm = null;
    const conversationId = 'conv-switch-skill-to-no-skill';
    await svc.clearConversationSession(conversationId);

    await svc.run({
      message: '先按框架场景保存会话',
      mode: 'chat',
      conversationId,
      context: {
        locale: 'zh',
        skillIds: ['frame'],
        providedValues: {
          inferredType: 'frame',
          skillId: 'frame',
          scenarioKey: 'frame',
          supportLevel: 'supported',
          supportNote: 'frame template support',
          lengthM: 12,
        },
      },
    });

    const switched = await svc.run({
      message: '切到通用模式继续',
      mode: 'chat',
      conversationId,
      context: {
        locale: 'zh',
        skillIds: [],
      },
    });

    expect(switched.interaction?.detectedScenario).toBeUndefined();
    expect(switched.interaction?.detectedScenarioLabel).toBeUndefined();
    expect(switched.interaction?.fallbackSupportNote).toBeUndefined();

    const snapshot = await svc.getConversationSessionSnapshot(conversationId, 'zh', []);
    expect(snapshot?.draft.inferredType).toBe('unknown');
    expect(snapshot?.draft.skillId).toBeUndefined();
    expect(snapshot?.draft.scenarioKey).toBeUndefined();

    await svc.clearConversationSession(conversationId);
  });

  test('should keep llm extractionMode in no-skill when llm extraction falls back', async () => {
    const svc = new AgentService();
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
    expect(draft.model).toBeDefined();
  });

  test('should fallback to generic llm model when skill scenarios stay unknown', async () => {
    const svc = new AgentService();
    svc.llm = {
      invoke: async () => ({
        content: '{"schema_version":"1.0.0","unit_system":"SI","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}',
      }),
    };

    const draft = await svc.textToModelDraft(
      '希望生成一个跨度10m的简支梁，荷载在4m处，一个集中荷载10kN',
      undefined,
      'zh',
      ['double-span-beam', 'frame', 'portal-frame', 'truss'],
    );

    expect(draft.inferredType).toBe('unknown');
    expect(draft.extractionMode).toBe('llm');
    expect(draft.model).toBeDefined();
    expect(draft.missingFields).toEqual([]);
  });

  test('should execute analyze in no-skill mode when computable model is provided', async () => {
    const svc = new AgentService();
    svc.llm = null;
    svc.engineClient.post = async (path, payload) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/analyze') {
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
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '按3m悬臂梁端部10kN点荷载做静力分析',
      mode: 'execute',
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
          load_cases: [{ id: 'LC1', type: 'dead', loads: [{ type: 'nodal', node: '2', fy: -10 }] }],
          load_combinations: [{ id: 'ULS1', factors: [{ case: 'LC1', factor: 1.0 }] }],
        },
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls.some((item) => item.tool === 'analyze' && item.status === 'success')).toBe(true);
  });

  test('should block no-skill execute when computable model is unavailable', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: '按3m悬臂梁端部10kN点荷载做静力分析',
      mode: 'execute',
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
    expect(result.toolCalls.some((item) => item.tool === 'analyze')).toBe(false);
  });

  test('should continue to analyze when validate returns an upstream 502', async () => {
    const svc = new AgentService();
    svc.llm = null;
    svc.engineClient.post = async (path, payload) => {
      if (path === '/validate') {
        const error = new Error('Request failed with status code 502');
        error.response = { status: 502, data: { message: 'bad gateway' } };
        throw error;
      }
      if (path === '/analyze') {
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
      if (path === '/code-check') {
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            details: [],
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请自动校核并生成报告',
      mode: 'execute',
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
        autoAnalyze: true,
        autoCodeCheck: true,
        designCode: 'GB50017',
        includeReport: true,
        reportFormat: 'both',
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls.find((call) => call.tool === 'validate')?.status).toBe('error');
    expect(result.toolCalls.find((call) => call.tool === 'analyze')?.status).toBe('success');
    expect(result.response).toContain('模型校验服务暂时不可用');
  });

  test('should retry analyze when the engine returns a transient 502', async () => {
    const svc = new AgentService();
    svc.llm = null;
    let analyzeAttempts = 0;
    svc.engineClient.post = async (path, payload) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/analyze') {
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
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请做静力分析',
      mode: 'execute',
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
    expect(result.toolCalls.find((call) => call.tool === 'analyze')?.status).toBe('success');
  });

  test('should report engine unavailable when analyze keeps returning 502', async () => {
    const svc = new AgentService();
    svc.llm = null;
    let analyzeAttempts = 0;
    svc.engineClient.post = async (path) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/analyze') {
        analyzeAttempts += 1;
        const error = new Error('Request failed with status code 502');
        error.response = { status: 502, data: { message: 'bad gateway' } };
        throw error;
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请做静力分析',
      mode: 'execute',
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
    const svc = new AgentService();
    svc.llm = null;
    svc.engineClient.post = async (path, payload) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      if (path === '/analyze') {
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
      if (path === '/code-check') {
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            details: [],
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: 'Run a static analysis and code check',
      mode: 'execute',
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
        autoAnalyze: true,
        autoCodeCheck: true,
        designCode: 'GB50017',
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

  test('should route steel frame requests to the dedicated frame scenario', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: 'Help me size a steel frame for static analysis',
      mode: 'chat',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.detectedScenario).toBe('steel-frame');
    expect(result.interaction?.detectedScenarioLabel).toBe('Steel Frame');
    expect(result.interaction?.conversationStage).toBe('Geometry');
    expect(result.interaction?.fallbackSupportNote).toBeUndefined();
    expect(result.interaction?.missingCritical).toContain('Story count');
    expect(result.response).toContain('Detected scenario: Steel Frame');
  });

  test('should block unsupported scenarios from silently falling back to beam extraction', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: '请帮我分析一个桥梁模型，跨度 30m',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.detectedScenario).toBe('bridge');
    expect(result.interaction?.fallbackSupportNote).toContain('桥梁');
    expect(result.interaction?.missingCritical).toContain('结构体系/构件拓扑描述（不限类型，可直接给结构模型JSON）');
    expect(result.response).toContain('识别场景：桥梁');
  });

  test('should build a complete 2d frame model from regular frame parameters', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const draft = await svc.textToModelDraft('2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN', undefined, 'zh');

    expect(draft.missingFields).toEqual([]);
    expect(draft.stateToPersist?.inferredType).toBe('frame');
    expect(draft.stateToPersist?.frameDimension).toBe('2d');
    expect(draft.stateToPersist?.storyHeightsM).toEqual([3, 3]);
    expect(draft.stateToPersist?.bayWidthsM).toEqual([6, 6]);
    expect(draft.model?.metadata?.inferredType).toBe('frame');
    expect(draft.model?.metadata?.storyCount).toBe(2);
    expect(draft.model?.metadata?.bayCount).toBe(2);
    expect(draft.model?.nodes).toHaveLength(9);
    expect(draft.model?.elements).toHaveLength(10);
    expect(draft.model?.load_cases?.[0]?.loads).toHaveLength(6);
  });

  test('should build a complete 3d frame model from regular grid parameters', async () => {
    const svc = new AgentService();
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
    const svc = new AgentService();
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
    expect(loads.every((load) => typeof load.fy === 'number' && typeof load.fx === 'number' && typeof load.fz === 'number')).toBe(true);
  });

  test('should mirror generic horizontal-load wording to both axes in 3d frame follow-up context', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-frame-generic-horizontal-3d',
      message: '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，每层竖向荷载90kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');

    const second = await svc.run({
      conversationId: 'conv-frame-generic-horizontal-3d',
      message: '水平方向荷载都是18kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    const loads = second.model?.load_cases?.[0]?.loads ?? [];
    expect(second.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');
    expect(loads).toHaveLength(12);
    expect(loads.every((load) => typeof load.fx === 'number' && typeof load.fz === 'number')).toBe(true);
  });

  test('should parse chinese two-direction horizontal-load wording in a single 3d frame sentence', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const draft = await svc.textToModelDraft(
      '我想设计一个三维框架结构，层数3层，各层层高3m，x向3跨，跨度为3m，y向2跨，跨度为3m，各层有竖向荷载1000kN，横向荷载两个方向都是500kN',
      undefined,
      'zh',
    );

    expect(draft.missingFields).toEqual([]);
    expect(draft.stateToPersist?.frameDimension).toBe('3d');
    expect(draft.stateToPersist?.floorLoads).toEqual([
      { story: 1, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
      { story: 2, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
      { story: 3, verticalKN: 1000, lateralXKN: 500, lateralYKN: 500 },
    ]);
    const loads = draft.model?.load_cases?.[0]?.loads ?? [];
    expect(loads.length).toBeGreaterThan(0);
    expect(loads.every((load) => typeof load.fy === 'number' && typeof load.fx === 'number' && typeof load.fz === 'number')).toBe(true);
  });

  test('should prefer llm-extracted frame floor loads for natural combined load wording', async () => {
    const svc = new AgentService();
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
    const svc = new AgentService();
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
    const svc = new AgentService();
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
    const svc = new AgentService();
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
    const svc = new AgentService();
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
    const svc = new AgentService();
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

  test('should upgrade a 2d frame chat session to 3d when llm extracts y-direction loads', async () => {
    const svc = new AgentService();
    svc.llm = {
      invoke: async (prompt) => {
        const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
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

    const first = await svc.run({
      conversationId: 'conv-frame-upgrade-3d',
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.detectedScenario).toBe('frame');
    expect(first.model?.metadata?.inferredType).toBe('frame');

    const second = await svc.run({
      conversationId: 'conv-frame-upgrade-3d',
      message: '每层竖向荷载120kN，x、y向水平荷载都是500kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(second.interaction?.detectedScenario).toBe('frame');
    expect(second.interaction?.missingCritical).toContain('X向跨数');
    expect(second.interaction?.missingCritical).toContain('Y向跨数');
    expect(second.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');
  });

  test('should accumulate frame follow-up phrases for story heights and lateral loads', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-frame-natural-followup',
      message: '我想设计一个三层框架，x方向4跨，间隔3m，y方向3跨间隔也是3m',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).toContain('各层层高（m）');
    expect(first.interaction?.missingCritical).toContain('各层节点荷载（kN）');

    const second = await svc.run({
      conversationId: 'conv-frame-natural-followup',
      message: '每层3m',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(second.interaction?.missingCritical).not.toContain('各层层高（m）');
    expect(second.interaction?.missingCritical).toContain('各层节点荷载（kN）');

    const third = await svc.run({
      conversationId: 'conv-frame-natural-followup',
      message: '各层竖向荷载都是1000kN，横向荷载都是500kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(third.interaction?.missingCritical).not.toContain('各层层高（m）');
    expect(third.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');
    expect(third.interaction?.state).toBe('collecting');
  });

  test('should merge 2d frame vertical and lateral loads across chat turns', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-frame-merge-2d-loads',
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');
    expect(first.model?.load_cases?.[0]?.loads).toHaveLength(6);
    expect(first.model?.load_cases?.[0]?.loads.every((load) => typeof load.fy === 'number' && load.fx === undefined)).toBe(true);

    const second = await svc.run({
      conversationId: 'conv-frame-merge-2d-loads',
      message: '每层水平荷载30kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    const loads = second.model?.load_cases?.[0]?.loads ?? [];
    expect(second.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');
    expect(loads).toHaveLength(6);
    expect(loads.every((load) => typeof load.fy === 'number' && typeof load.fx === 'number')).toBe(true);
    expect(second.model?.metadata?.inferredType).toBe('frame');
  });

  test('should merge 3d frame y-direction lateral loads without dropping existing floor loads', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const first = await svc.run({
      conversationId: 'conv-frame-merge-3d-loads',
      message: '3D框架，2层，x向2跨每跨6m，y向1跨每跨5m，每层3m，每层竖向荷载90kN，x向水平荷载18kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    expect(first.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');
    expect(first.model?.load_cases?.[0]?.loads).toHaveLength(12);
    expect(first.model?.load_cases?.[0]?.loads.every((load) => typeof load.fy === 'number' && typeof load.fx === 'number' && load.fz === undefined)).toBe(true);

    const second = await svc.run({
      conversationId: 'conv-frame-merge-3d-loads',
      message: 'y向水平荷载12kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    const loads = second.model?.load_cases?.[0]?.loads ?? [];
    expect(second.interaction?.missingCritical).not.toContain('各层节点荷载（kN）');
    expect(loads).toHaveLength(12);
    expect(loads.every((load) => typeof load.fy === 'number' && typeof load.fx === 'number' && typeof load.fz === 'number')).toBe(true);
    expect(second.model?.metadata?.bayCountX).toBe(2);
    expect(second.model?.metadata?.bayCountY).toBe(1);
  });

  test('should expose a conversation session snapshot for context restoration', async () => {
    const svc = new AgentService();
    svc.llm = null;

    await svc.run({
      conversationId: 'conv-session-snapshot',
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
      mode: 'chat',
      context: { locale: 'zh' },
    });

    const snapshot = await svc.getConversationSessionSnapshot('conv-session-snapshot', 'zh');

    expect(snapshot).toBeDefined();
    expect(snapshot?.draft?.inferredType).toBe('frame');
    expect(snapshot?.resolved?.analysisType).toBe('static');
    expect(snapshot?.interaction?.detectedScenario).toBe('frame');
    expect(snapshot?.interaction?.conversationStage).toBe('荷载条件');
    expect(snapshot?.model?.metadata?.inferredType).toBe('frame');
  });

  test('should persist agent chat messages for conversation history restoration', async () => {
    const svc = new AgentService();
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
      await svc.run({
        conversationId: 'conv-persist-history',
        message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
        mode: 'chat',
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
    expect(recorded[1]?.content).toContain('识别场景');
  });

  test('should keep regular frame chat in model stage until frame geometry is complete', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: '请先聊一个框架',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.detectedScenario).toBe('frame');
    expect(result.interaction?.stage).toBe('model');
    expect(result.interaction?.missingCritical).toContain('层数');
    expect(result.interaction?.missingCritical).toContain('各层节点荷载（kN）');
  });

  test('should advance chat guidance to load stage once portal geometry is known', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const result = await svc.run({
      message: 'Portal frame, each span 6 m and column height 4 m',
      mode: 'chat',
      context: {
        locale: 'en',
      },
    });

    expect(result.success).toBe(true);
    expect(result.interaction?.detectedScenario).toBe('portal-frame');
    expect(result.interaction?.stage).toBe('loads');
    expect(result.interaction?.conversationStage).toBe('Loads');
    expect(result.interaction?.missingCritical).toContain('Load magnitude (kN)');
    expect(result.interaction?.recommendedNextStep).toContain('Load');
  });

  test('should return synchronized model once chat has a complete structural model', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const collecting = await svc.run({
      message: '简支梁，跨度6m，20kN跨中点荷载',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(collecting.success).toBe(true);
    expect(collecting.interaction?.state).toBe('collecting');
    expect(collecting.interaction?.missingOptional).toContain('是否自动规范校核');
    expect(collecting.interaction?.missingOptional).toContain('是否生成报告');
    expect(collecting.model?.schema_version).toBe('1.0.0');
    expect(Array.isArray(collecting.model?.nodes)).toBe(true);

    const incomplete = await svc.run({
      message: '我想设计一个梁',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(incomplete.success).toBe(true);
    expect(incomplete.interaction?.state).toBe('confirming');
    expect(incomplete.model).toBeUndefined();
  });

  test('should return synchronized frame model before noncritical report preferences are ready', async () => {
    const svc = new AgentService();
    svc.llm = null;

    const collecting = await svc.run({
      message: '2层2跨框架，每层3m，每跨6m，每层竖向荷载120kN，水平荷载30kN',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });

    expect(collecting.success).toBe(true);
    expect(collecting.interaction?.detectedScenario).toBe('frame');
    expect(collecting.interaction?.state).toBe('collecting');
    expect(collecting.model?.schema_version).toBe('1.0.0');
    expect(collecting.model?.metadata?.inferredType).toBe('frame');
    expect(Array.isArray(collecting.model?.nodes)).toBe(true);
  });
});
