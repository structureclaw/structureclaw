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

  test('does not infer analysis type from seismic keywords without semantic routing', () => {
    const policy = new AgentPolicyService();

    expect(policy.inferAnalysisType('按中国抗震规范做反应谱和时程分析')).toBe('static');
    expect(policy.inferAnalysisType('run seismic time-history analysis')).toBe('static');
  });

  test('does not infer China seismic design codes from regex policy helpers', () => {
    const policy = new AgentPolicyService();

    expect(policy.inferDesignCode('按 GB50011 做抗震校核')).toBeUndefined();
    expect(policy.inferDesignCode('按 GB 55002 + GB/T 50011 做中国抗震流程')).toBeUndefined();
    expect(policy.inferDesignCode('按 GB50017 做钢结构校核')).toBe('GB50017');
  });
});
