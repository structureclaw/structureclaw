#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build --prefix backend >/dev/null

node - <<'JS'
const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const run = async () => {
  process.env.LLM_API_KEY = '';
  process.env.OPENAI_API_KEY = '';
  process.env.ZAI_API_KEY = '';
  process.env.LLM_PROVIDER = 'openai';
  const fs = await import('node:fs');
  const { AgentService } = await import('./backend/dist/services/agent.js');

  // 0) protocol metadata
  {
    const protocol = AgentService.getProtocol();
    assert(protocol.version === '2.0.0', 'protocol version should be 2.0.0');
    assert(Array.isArray(protocol.tools) && protocol.tools.length >= 3, 'protocol tools should be present');
    assert(protocol.runRequestSchema?.type === 'object', 'runRequestSchema should be json schema object');
    assert(protocol.runResultSchema?.type === 'object', 'runResultSchema should be json schema object');
    assert(Array.isArray(protocol.streamEventSchema?.oneOf), 'streamEventSchema should include oneOf');
    assert(protocol.tools.some((t) => t.name === 'analyze'), 'analyze tool spec should exist');
    assert(protocol.tools.every((t) => t.outputSchema && typeof t.outputSchema === 'object'), 'tool outputSchema should exist');
    assert(protocol.tools.every((t) => Array.isArray(t.errorCodes)), 'tool errorCodes should be array');
    console.log('[ok] agent protocol metadata');
  }

  // 1) missing model -> clarification
  {
    const svc = new AgentService();
    const result = await svc.run({ message: '帮我算一下门式刚架' });
    assert(result.success === false, 'missing model should fail');
    assert(result.needsModelInput === true, 'missing model should require model input');
    console.log('[ok] agent missing-model clarification');
  }

  // 2) validate failure path
  {
    const svc = new AgentService();
    svc.engineClient.post = async (path) => {
      if (path === '/validate') {
        const err = new Error('validation failed');
        err.response = { data: { errorCode: 'INVALID_STRUCTURE_MODEL' } };
        throw err;
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '做静力分析',
      context: {
        model: { schema_version: '1.0.0' },
      },
    });
    assert(result.success === false, 'validate failure should fail');
    assert(result.response.includes('模型校验失败'), 'validate failure response should be surfaced');
    assert(result.toolCalls.some((c) => c.tool === 'validate' && c.error), 'validate error trace should exist');
    console.log('[ok] agent validate-failure trace');
  }

  // 3) success orchestration path
  {
    const svc = new AgentService();
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
      message: '静力分析这个模型',
      context: {
        model: {
          schema_version: '1.0.0',
          nodes: [],
          elements: [],
          materials: [],
          sections: [],
        },
        autoAnalyze: true,
      },
    });

    assert(result.success === true, 'successful orchestration should succeed');
    assert(result.toolCalls.some((c) => c.tool === 'validate'), 'validate should be called');
    assert(result.toolCalls.some((c) => c.tool === 'analyze'), 'analyze should be called');
    assert(result.toolCalls.some((c) => c.tool === 'report'), 'report should be generated');
    assert(result.report && result.report.summary, 'report payload should exist');
    assert(result.metrics?.toolCount >= 2, 'tool metrics should be present');
    assert(typeof result.startedAt === 'string' && typeof result.completedAt === 'string', 'run timestamps should be present');
    assert(result.metrics?.totalToolDurationMs >= 0, 'total tool duration metrics should be present');
    assert(typeof result.metrics?.toolDurationMsByName === 'object', 'toolDurationMsByName should be present');
    console.log('[ok] agent success orchestration');
  }

  // 4) stream orchestration events
  {
    const svc = new AgentService();
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

    const events = [];
    let streamTraceId;
    let resultTraceId;
    for await (const chunk of svc.runStream({
      message: 'stream test',
      mode: 'execute',
      context: { model: { schema_version: '1.0.0' } },
    })) {
      events.push(chunk.type);
      if (chunk.type === 'start') {
        streamTraceId = chunk.content.traceId;
        assert(typeof chunk.content.startedAt === 'string', 'stream start should include startedAt');
      }
      if (chunk.type === 'result') {
        resultTraceId = chunk.content.traceId;
      }
    }

    assert(events[0] === 'start', 'stream first event should be start');
    assert(events.includes('result'), 'stream should include result event');
    assert(events[events.length - 1] === 'done', 'stream last event should be done');
    assert(streamTraceId && resultTraceId && streamTraceId === resultTraceId, 'stream/result traceId should match');
    console.log('[ok] agent stream events');
  }

  // 5) text-to-model draft success path
  {
    const svc = new AgentService();
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
      message: '请按一个3m悬臂梁，端部10kN竖向荷载做静力分析',
      mode: 'execute',
      context: {
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });

    assert(result.success === true, 'text draft orchestration should succeed');
    assert(result.toolCalls.some((c) => c.tool === 'text-to-model-draft'), 'text draft tool should be called');
    assert(result.toolCalls.some((c) => c.tool === 'validate'), 'validate should be called after draft');
    assert(result.toolCalls.some((c) => c.tool === 'analyze'), 'analyze should be called after draft');
    console.log('[ok] agent text-to-model draft orchestration');
  }

  // 6) conversation-level clarification carry-over
  {
    const svc = new AgentService();
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

    const first = await svc.run({
      conversationId: 'conv-clarify-1',
      message: '请帮我算一个门式刚架',
      mode: 'execute',
    });
    assert(first.success === false, 'first turn should request clarification');
    assert(first.needsModelInput === true, 'first turn should require model input');

    const second = await svc.run({
      conversationId: 'conv-clarify-1',
      message: '跨度6m，柱高4m，竖向荷载20kN，做静力分析',
      mode: 'execute',
      context: {
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });
    assert(second.success === true, 'second turn should complete using persisted draft state');
    assert(second.toolCalls.some((c) => c.tool === 'text-to-model-draft'), 'second turn should still draft model');
    console.log('[ok] conversation-level clarification carry-over');
  }

  // 6.0) chat-ready should return synchronized model, incomplete chat should not
  {
    const svc = new AgentService();

    const ready = await svc.run({
      conversationId: 'conv-chat-ready-model',
      message: '3m悬臂梁，端部10kN点荷载，静力分析，按GB50017校核，生成报告',
      mode: 'chat',
      context: {
        locale: 'zh',
        analysisType: 'static',
        autoCodeCheck: true,
        designCode: 'GB50017',
        includeReport: true,
        reportFormat: 'both',
        reportOutput: 'inline',
      },
    });
    assert(ready.success === true, 'chat-ready turn should succeed');
    assert(ready.interaction?.state === 'ready', `expected ready state, got ${ready.interaction?.state}`);
    assert(ready.model && Array.isArray(ready.model.nodes), 'chat-ready turn should return synchronized model');

    const incomplete = await svc.run({
      conversationId: 'conv-chat-incomplete-model',
      message: '帮我设计一个梁',
      mode: 'chat',
      context: {
        locale: 'zh',
      },
    });
    assert(incomplete.success === true, 'incomplete chat turn should succeed');
    assert(incomplete.interaction?.state !== 'ready', 'incomplete chat turn should not be ready');
    assert(incomplete.model === undefined, 'incomplete chat turn should not return synchronized model');
    console.log('[ok] chat ready model sync contract');
  }

  // 6.1) chat-mode follow-up should shrink missing fields instead of repeating span
  {
    const svc = new AgentService();

    const first = await svc.run({
      conversationId: 'conv-chat-followup-1',
      message: '先聊需求，我要做一个门式刚架',
      mode: 'chat',
    });
    assert(
      first.interaction?.missingCritical?.includes('门式刚架或双跨每跨跨度（m）'),
      'first chat turn should ask for portal-frame span'
    );

    const second = await svc.run({
      conversationId: 'conv-chat-followup-1',
      message: '跨度10m',
      mode: 'chat',
    });
    assert(second.success === true, 'second chat turn should still succeed');
    assert(second.interaction?.detectedScenario === 'portal-frame', 'chat follow-up should keep portal-frame scenario');
    assert(
      !second.interaction?.missingCritical?.includes('门式刚架或双跨每跨跨度（m）'),
      'second chat turn should not ask for span again'
    );
    assert(
      second.interaction?.missingCritical?.includes('门式刚架柱高（m）'),
      'second chat turn should continue with height'
    );
    console.log('[ok] chat clarification follow-up shrinkage');
  }

  // 6.2) beam follow-up should ask for support before load details after span is provided
  {
    const svc = new AgentService();

    const first = await svc.run({
      conversationId: 'conv-chat-followup-beam-1',
      message: '我想设计一个梁',
      mode: 'chat',
    });
    assert(
      first.interaction?.missingCritical?.includes('跨度/长度（m）'),
      'first beam chat turn should ask for span'
    );

    const second = await svc.run({
      conversationId: 'conv-chat-followup-beam-1',
      message: '跨度10m',
      mode: 'chat',
    });
    assert(second.success === true, 'second beam chat turn should still succeed');
    assert(second.interaction?.detectedScenario === 'beam', 'beam follow-up should keep beam scenario');
    assert(
      !second.interaction?.missingCritical?.includes('跨度/长度（m）'),
      'second beam chat turn should not ask for span again'
    );
    assert(
      second.interaction?.missingCritical?.includes('荷载大小（kN）'),
      'second beam chat turn should continue with load'
    );
    assert(
      second.interaction?.missingCritical?.includes('支座/边界条件（悬臂/简支/两端固结/固铰）'),
      'second beam chat turn should require support type before load details'
    );
    assert(
      !second.interaction?.missingCritical?.includes('荷载形式（点荷载/均布荷载）'),
      'second beam chat turn should not require load type before support type is known'
    );
    assert(
      !second.interaction?.missingCritical?.includes('荷载位置（按当前结构模板）'),
      'second beam chat turn should not require load position before support type is known'
    );

    const third = await svc.run({
      conversationId: 'conv-chat-followup-beam-1',
      message: '简支',
      mode: 'chat',
    });
    assert(third.success === true, 'third beam chat turn should still succeed');
    assert(
      !third.interaction?.missingCritical?.includes('支座/边界条件（悬臂/简支/两端固结/固铰）'),
      'third beam chat turn should not ask for support type again'
    );
    assert(
      third.interaction?.missingCritical?.includes('荷载大小（kN）'),
      'third beam chat turn should still require load magnitude'
    );
    assert(
      third.interaction?.missingCritical?.includes('荷载形式（点荷载/均布荷载）'),
      'third beam chat turn should require load type after support type is known'
    );
    assert(
      third.interaction?.missingCritical?.includes('荷载位置（按当前结构模板）'),
      'third beam chat turn should require load position after support type is known'
    );
    console.log('[ok] beam chat clarification follow-up shrinkage');
  }

  // 7) draft type coverage: double-span beam and planar truss
  {
    const svc = new AgentService();
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

    const beam = await svc.run({
      message: '按双跨梁建模，每跨4m，中跨节点施加12kN竖向荷载做静力分析',
      mode: 'execute',
      context: {
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });
    assert(beam.success === true, 'double-span beam draft should succeed');
    assert(Array.isArray(beam.model?.elements) && beam.model.elements.length === 2, 'double-span beam should have 2 elements');

    const truss = await svc.run({
      message: '建立一个平面桁架，长度5m，10kN轴向荷载并计算',
      mode: 'execute',
      context: {
        userDecision: 'allow_auto_decide',
        autoCodeCheck: false,
        includeReport: false,
      },
    });
    assert(truss.success === true, 'planar truss draft should succeed');
    assert(Array.isArray(truss.model?.elements) && truss.model.elements[0]?.type === 'truss', 'truss draft should produce truss element');
    console.log('[ok] draft type coverage');
  }

  // 8) analyze -> code-check -> report closed loop
  {
    const svc = new AgentService();
    let capturedCodeCheckPayload;
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
        capturedCodeCheckPayload = payload;
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            traceability: { analysisSummary: payload.context?.analysisSummary || {} },
            details: [{
              elementId: payload.elements[0],
              status: 'pass',
              checks: [{
                name: '强度验算',
                items: [{
                  item: '正应力',
                  clause: 'GB50017-2017 7.1.1',
                  formula: 'σ = N/A <= f',
                  inputs: { demand: 0.7, capacity: 1.0, limit: 1.0 },
                  utilization: 0.7,
                  status: 'pass',
                }],
              }],
            }],
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await svc.run({
      message: '请对该模型做静力分析并按GB50017做规范校核并出报告',
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
        parameters: {
          utilizationByElement: {
            E1: {
              '正应力': 0.72,
            },
          },
        },
        includeReport: true,
        reportFormat: 'both',
        reportOutput: 'file',
      },
    });

    assert(result.success === true, 'closed loop should succeed');
    assert(result.toolCalls.some((c) => c.tool === 'code-check'), 'code-check should be called');
    assert(result.toolCalls.some((c) => c.tool === 'report'), 'report should be called');
    assert(result.codeCheck?.code === 'GB50017', 'code-check output should exist');
    assert(capturedCodeCheckPayload?.context?.analysisSummary?.analysisType === 'static', 'analysis summary should be forwarded');
    assert(capturedCodeCheckPayload?.context?.utilizationByElement?.E1?.['正应力'] === 0.72, 'utilization context should be forwarded');
    assert(result.codeCheck?.details?.[0]?.checks?.[0]?.items?.[0]?.clause, 'code-check should include traceable clause');
    assert(typeof result.report?.markdown === 'string', 'markdown report should be generated');
    assert(Array.isArray(result.artifacts) && result.artifacts.length >= 1, 'report artifacts should be generated');
    assert(result.artifacts.every((a) => fs.existsSync(a.path)), 'report artifact files should exist');
    for (const artifact of result.artifacts) {
      fs.unlinkSync(artifact.path);
    }
    console.log('[ok] analyze code-check report closed loop');
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
