import { describe, expect, test } from '@jest/globals';

describe('AgentSessionState: emptySessionState', () => {
  test('returns correct default values', async () => {
    const { emptySessionState } = await import('../../../dist/agent-langgraph/state.js');

    const state = emptySessionState();
    expect(state.draftState).toBeNull();
    expect(state.artifacts).toEqual({});
    expect(state.selectedSkillIds).toEqual([]);
    expect(state.locale).toBe('zh');
    expect(state.workspaceRoot).toBe('');
    expect(state.policy).toEqual({});
    expect(state.contextSeismicWorkflow).toBeNull();
    expect(state.bindings).toEqual({});
    expect(state.lastUserMessage).toBe('');
    expect(state.structuralTypeKey).toBeNull();
  });

  test('applies overrides', async () => {
    const { emptySessionState } = await import('../../../dist/agent-langgraph/state.js');

    const state = emptySessionState({ locale: 'en', workspaceRoot: '/tmp/workspace' });
    expect(state.locale).toBe('en');
    expect(state.workspaceRoot).toBe('/tmp/workspace');
    // Unoverridden fields remain at defaults
    expect(state.draftState).toBeNull();
    expect(state.selectedSkillIds).toEqual([]);
  });

  test('does not share mutable default values between instances', async () => {
    const { emptySessionState } = await import('../../../dist/agent-langgraph/state.js');

    const a = emptySessionState();
    const b = emptySessionState();
    a.selectedSkillIds.push('frame');
    expect(b.selectedSkillIds).toEqual([]);
    a.artifacts['model'] = { kind: 'model' };
    expect(b.artifacts).toEqual({});
  });

  test('partial overrides: only specified fields change', async () => {
    const { emptySessionState } = await import('../../../dist/agent-langgraph/state.js');

    const draft = { inferredType: 'beam', skillId: 'simple-beam' };
    const state = emptySessionState({ draftState: draft, selectedSkillIds: ['simple-beam'] });
    expect(state.draftState).toBe(draft);
    expect(state.selectedSkillIds).toEqual(['simple-beam']);
    expect(state.locale).toBe('zh');
    expect(state.workspaceRoot).toBe('');
  });

  test('policy and bindings default to empty objects', async () => {
    const { emptySessionState } = await import('../../../dist/agent-langgraph/state.js');

    const state = emptySessionState();
    expect(Object.keys(state.policy)).toHaveLength(0);
    expect(Object.keys(state.bindings)).toHaveLength(0);
  });
});

describe('AgentStateAnnotation: schema shape', () => {
  test('annotation exports AgentStateAnnotation with expected channel keys', async () => {
    const { AgentStateAnnotation } = await import('../../../dist/agent-langgraph/state.js');

    const expectedKeys = [
      'messages', 'draftState', 'artifacts', 'selectedSkillIds',
      'locale', 'workspaceRoot', 'policy', 'contextSeismicWorkflow', 'bindings',
      'lastUserMessage', 'structuralTypeKey',
      'model', 'analysisResult', 'codeCheckResult', 'report',
    ];
    for (const key of expectedKeys) {
      expect(AgentStateAnnotation.spec).toHaveProperty(key);
    }
  });

  test('annotation spec channels are LangGraph channel objects', async () => {
    const { AgentStateAnnotation } = await import('../../../dist/agent-langgraph/state.js');

    // LangGraph BinaryOperatorAggregate / LastValue channels expose a getValue method
    // or at minimum are non-null objects
    for (const [key, channel] of Object.entries(AgentStateAnnotation.spec)) {
      expect(channel).not.toBeNull();
      expect(typeof channel).toBe('object');
      expect(channel.lc_graph_name).toBeDefined();
    }
  });
});
