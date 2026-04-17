import { describe, expect, test } from '@jest/globals';
import { AgentPolicyService } from '../../../dist/services/agent-policy.js';

describe('agent policy execution intent', () => {
  test('detects natural chinese structural design requests with concrete parameters', () => {
    const policy = new AgentPolicyService();

    expect(policy.inferExecutionIntent('设计一个简支梁，跨度10m，梁中间荷载1kN')).toBe(true);
  });

  test('detects natural english structural sizing requests with concrete parameters', () => {
    const policy = new AgentPolicyService();

    expect(policy.inferExecutionIntent('Size a simply supported beam with a 10m span and 1kN midspan load')).toBe(true);
  });

  test('does not treat generic non-structural design language as execution intent', () => {
    const policy = new AgentPolicyService();

    expect(policy.inferExecutionIntent('帮我设计一个产品海报')).toBe(false);
  });
});
