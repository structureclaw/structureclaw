import type {
  AgentPolicyAnalysisType,
  AgentPolicyReportFormat,
  AgentPolicyReportOutput,
} from '../../services/agent-policy.js';
import { AgentPolicyService } from '../../services/agent-policy.js';
import type { AgentAnalysisType } from '../../agent-runtime/types.js';

const ANALYSIS_TYPE_SET = new Set<AgentAnalysisType>(['static', 'dynamic', 'seismic', 'nonlinear']);

export function inferAnalysisType(policy: AgentPolicyService, message: string): AgentPolicyAnalysisType {
  return policy.inferAnalysisType(message);
}

export function inferCodeCheckIntent(policy: AgentPolicyService, message: string): boolean {
  return policy.inferCodeCheckIntent(message);
}

export function inferReportIntent(policy: AgentPolicyService, message: string): boolean | undefined {
  return policy.inferReportIntent(message);
}

export function normalizePolicyAnalysisType(policy: AgentPolicyService, value: string): AgentPolicyAnalysisType {
  return policy.normalizeAnalysisType(value);
}

export function normalizePolicyReportFormat(policy: AgentPolicyService, value: string): AgentPolicyReportFormat {
  return policy.normalizeReportFormat(value);
}

export function normalizePolicyReportOutput(policy: AgentPolicyService, value: string): AgentPolicyReportOutput {
  return policy.normalizeReportOutput(value);
}

export function normalizeAnalysisTypes(value: unknown): AgentAnalysisType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value.filter((item): item is AgentAnalysisType => ANALYSIS_TYPE_SET.has(item as AgentAnalysisType));
  return Array.from(new Set(normalized));
}
