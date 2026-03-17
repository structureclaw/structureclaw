import type {
  AgentPolicyAnalysisType,
  AgentPolicyReportFormat,
  AgentPolicyReportOutput,
} from '../../services/agent-policy.js';
import { AgentPolicyService } from '../../services/agent-policy.js';
import { normalizeAnalysisTypes } from '../../services/agent-skills/domains/material-analysis.js';

export function inferAnalysisType(policy: AgentPolicyService, message: string): AgentPolicyAnalysisType {
  return policy.inferAnalysisType(message);
}

export function inferCodeCheckIntent(policy: AgentPolicyService, message: string): boolean {
  return policy.inferCodeCheckIntent(message);
}

export function inferReportIntent(policy: AgentPolicyService, message: string): boolean | undefined {
  return policy.inferReportIntent(message);
}

export function inferDesignCode(policy: AgentPolicyService, message: string): string | undefined {
  return policy.inferDesignCode(message);
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

export { normalizeAnalysisTypes };
