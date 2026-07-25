import { describe, expect, test } from '@jest/globals';

describe('detect_structure_type tool guidance', () => {
  test('stops before extraction when the LLM identifies an unsupported workflow', async () => {
    const { createDetectStructureTypeTool } = await import('../../../dist/agent-langgraph/tools.js');
    const detectStructureType = createDetectStructureTypeTool({
      async detectStructuralTypeWithLlm() {
        return {
          key: 'tower',
          mappedType: 'unknown',
          supportLevel: 'unsupported',
          supportNote: 'No tower or time-history adapter is available.',
          routingSource: 'llm-suggested',
        };
      },
    });

    const command = await detectStructureType.invoke(
      { message: 'Analyze a tower using wind vibration and seismic time history.', locale: 'en' },
      { toolCall: { id: 'call-unsupported' }, configurable: { agentState: {} } },
    );
    const result = JSON.parse(command.update.messages[0].content);

    expect(result).toMatchObject({
      key: 'tower',
      supportLevel: 'unsupported',
      routingSource: 'llm-suggested',
      nextAction: 'explain_capability_boundary',
    });
    expect(result.instruction).toContain('Do not extract parameters');
    expect(result.instruction).toContain('supported alternative workflow');
  });

  test('continues to LLM parameter extraction for a supported workflow', async () => {
    const { createDetectStructureTypeTool } = await import('../../../dist/agent-langgraph/tools.js');
    const detectStructureType = createDetectStructureTypeTool({
      async detectStructuralTypeWithLlm() {
        return {
          key: 'beam',
          mappedType: 'beam',
          skillId: 'beam',
          supportLevel: 'supported',
          routingSource: 'llm-suggested',
        };
      },
    });

    const command = await detectStructureType.invoke(
      { message: 'Analyze a 6 m beam.', locale: 'en' },
      { toolCall: { id: 'call-supported' }, configurable: { agentState: {} } },
    );
    const result = JSON.parse(command.update.messages[0].content);

    expect(result).toMatchObject({
      key: 'beam',
      supportLevel: 'supported',
      nextAction: 'extract_draft_params',
    });
  });

  test('passes the abort signal and records nested routing usage in benchmark mode', async () => {
    const previous = process.env.SCLAW_BENCHMARK_LLM_ONLY;
    process.env.SCLAW_BENCHMARK_LLM_ONLY = '1';
    const controller = new AbortController();
    let receivedSignal;
    try {
      const { createDetectStructureTypeTool } = await import('../../../dist/agent-langgraph/tools.js');
      const detectStructureType = createDetectStructureTypeTool({
        async detectStructuralTypeWithLlm(
          _llm,
          _message,
          _locale,
          _currentState,
          _skillIds,
          signal,
          onUsage,
        ) {
          receivedSignal = signal;
          onUsage?.({ inputTokens: 40, outputTokens: 10, totalTokens: 50 });
          return {
            key: 'beam',
            mappedType: 'beam',
            skillId: 'beam',
            supportLevel: 'supported',
            routingSource: 'llm-suggested',
          };
        },
      });

      const command = await detectStructureType.invoke(
        { message: 'Analyze a 6 m beam.', locale: 'en' },
        {
          signal: controller.signal,
          toolCall: { id: 'call-usage' },
          configurable: { agentState: {} },
        },
      );
      const responseMetadata = command.update.messages[0].response_metadata;

      expect(receivedSignal).toBe(controller.signal);
      expect(responseMetadata).toMatchObject({
        tokenUsage: {
          promptTokens: 40,
          completionTokens: 10,
          totalTokens: 50,
        },
        tokenUsageSource: 'nested-benchmark-call',
      });
    } finally {
      if (previous === undefined) delete process.env.SCLAW_BENCHMARK_LLM_ONLY;
      else process.env.SCLAW_BENCHMARK_LLM_ONLY = previous;
    }
  });

  test('keeps invalid router output as a measured model failure with its token usage', async () => {
    const previous = process.env.SCLAW_BENCHMARK_LLM_ONLY;
    process.env.SCLAW_BENCHMARK_LLM_ONLY = '1';
    try {
      const { createDetectStructureTypeTool } = await import('../../../dist/agent-langgraph/tools.js');
      const detectStructureType = createDetectStructureTypeTool({
        async detectStructuralTypeWithLlm(
          _llm,
          _message,
          _locale,
          _currentState,
          _skillIds,
          _signal,
          onUsage,
        ) {
          onUsage?.({ inputTokens: 25, outputTokens: 5, totalTokens: 30 });
          throw new Error(
            'LLM_STRUCTURAL_ROUTER_INVALID_OUTPUT: response did not contain a usable routing decision',
          );
        },
      });

      const command = await detectStructureType.invoke(
        { message: 'Analyze this structure.', locale: 'en' },
        { toolCall: { id: 'call-invalid' }, configurable: { agentState: {} } },
      );
      const toolMessage = command.update.messages[0];

      expect(JSON.parse(toolMessage.content)).toMatchObject({
        success: false,
        errorCode: 'LLM_STRUCTURAL_ROUTER_INVALID_OUTPUT',
        nextAction: 'retry_detection',
      });
      expect(toolMessage.response_metadata.tokenUsage).toEqual({
        promptTokens: 25,
        completionTokens: 5,
        totalTokens: 30,
      });
    } finally {
      if (previous === undefined) delete process.env.SCLAW_BENCHMARK_LLM_ONLY;
      else process.env.SCLAW_BENCHMARK_LLM_ONLY = previous;
    }
  });
});
