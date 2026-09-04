/**
 * Design-loop state machine for the Agent design cycle:
 * analyze → code-check → (fail) → design → re-analyze → …
 *
 * Pure functions only — the LangGraph tool applies the results to graph
 * state. The loop stops when the code check passes, the provider cannot
 * propose further changes, the user has not approved changes, or the
 * configurable max-iteration guard is reached (default 10).
 */
import type {
  AgentDesignLoopState,
  DesignLoopAction,
  DesignSectionChange,
  SkillDesignResult,
} from '../../agent-runtime/types.js';
import type { DesignProviderResult } from './provider.js';

export const DEFAULT_DESIGN_MAX_ITERATIONS = 10;
export const DESIGN_LOOP_PROVIDER_LOCAL = 'local-rule';
export const DESIGN_LOOP_PROVIDER_GUARD = 'loop-guard';

export function createEmptyDesignLoopState(maxIterations: number = DEFAULT_DESIGN_MAX_ITERATIONS): AgentDesignLoopState {
  return {
    iterations: [],
    maxIterations,
    lastAction: null,
    converged: false,
    updatedAt: new Date().toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export interface CodeCheckStats {
  total: number;
  failed: number;
  passed: number;
  maxUtilization?: number;
}

/** Normalize the code-check summary counts used to decide loop convergence. */
export function extractCodeCheckStats(codeCheck: unknown): CodeCheckStats {
  const summary = asRecord(asRecord(codeCheck).summary);
  return {
    total: toCount(summary.total),
    failed: toCount(summary.failed),
    passed: toCount(summary.passed),
    ...(Number.isFinite(Number(summary.maxUtilization))
      ? { maxUtilization: Number(summary.maxUtilization) }
      : {}),
  };
}

/** Whether the current code-check result passes (loop exit condition). */
export function isDesignConverged(codeCheck: unknown): boolean {
  const stats = extractCodeCheckStats(codeCheck);
  return stats.total > 0 && stats.failed === 0;
}

/** Next 1-based iteration number for a loop state. */
export function nextDesignIteration(state: AgentDesignLoopState | null | undefined): number {
  return (state?.iterations.length ?? 0) + 1;
}

/** Whether the max-iteration guard blocks a further design iteration. */
export function isDesignLoopExhausted(state: AgentDesignLoopState | null | undefined): boolean {
  const maxIterations = state?.maxIterations ?? DEFAULT_DESIGN_MAX_ITERATIONS;
  return (state?.iterations.length ?? 0) >= maxIterations;
}

/** Append one design iteration to the loop state (immutable). */
export function reduceDesignIteration(
  previous: AgentDesignLoopState | null | undefined,
  result: SkillDesignResult,
): AgentDesignLoopState {
  const base = previous ?? createEmptyDesignLoopState(result.maxIterations);
  const record = {
    iteration: result.iteration,
    provider: result.provider,
    action: result.action,
    applied: result.applied,
    converged: result.converged,
    changes: result.changes,
    summary: result.summary,
    ...(result.maxUtilizationBefore !== undefined ? { maxUtilizationBefore: result.maxUtilizationBefore } : {}),
    ...(result.maxUtilizationAfter !== undefined ? { maxUtilizationAfter: result.maxUtilizationAfter } : {}),
    ...(result.costEstimate !== undefined ? { costEstimate: result.costEstimate } : {}),
    completedAt: new Date().toISOString(),
  };
  const lastAction: DesignLoopAction = result.action;
  return {
    iterations: [...base.iterations, record],
    maxIterations: result.maxIterations || base.maxIterations,
    lastAction,
    converged: base.converged || result.converged,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mark the loop as stopped without consuming an iteration slot (code check
 * passing, or the max-iteration guard fired before a provider ran).
 */
export function markDesignLoopStopped(
  previous: AgentDesignLoopState | null | undefined,
  action: 'converged' | 'max_iterations_reached',
): AgentDesignLoopState {
  const base = previous ?? createEmptyDesignLoopState();
  return {
    ...base,
    lastAction: action,
    converged: base.converged || action === 'converged',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Result used when the loop stops without invoking a provider (code check
 * already passing or max-iteration guard reached).
 */
export function buildDesignLoopStopResult(options: {
  action: 'converged' | 'max_iterations_reached';
  iteration: number;
  maxIterations: number;
  provider?: string;
}): SkillDesignResult {
  const converged = options.action === 'converged';
  return {
    provider: options.provider ?? DESIGN_LOOP_PROVIDER_GUARD,
    applied: false,
    action: options.action,
    iteration: options.iteration,
    maxIterations: options.maxIterations,
    converged,
    changes: [],
    summary: converged
      ? {
          zh: '规范校核已全部通过，设计迭代收敛。',
          en: 'All code checks pass; the design loop has converged.',
        }
      : {
          zh: `已达到最大设计迭代次数（${options.maxIterations}），停止迭代。`,
          en: `Reached the maximum number of design iterations (${options.maxIterations}); the loop stopped.`,
        },
  };
}

// ---------------------------------------------------------------------------
// Provider → SkillDesignResult bridge
// ---------------------------------------------------------------------------

/** Localized summary text for a design proposal. */
export function summarizeDesignChanges(changes: DesignSectionChange[], locale: 'zh' | 'en'): string {
  if (changes.length === 0) {
    return locale === 'zh' ? '本次未产生设计调整。' : 'No design changes were produced.';
  }
  const head = changes[0];
  const pattern = locale === 'zh'
    ? `${head.before} → ${head.after}（利用率 ${head.utilizationBefore ?? '?'} → 预计 ${head.utilizationAfter ?? '?'}）`
    : `${head.before} → ${head.after} (utilization ${head.utilizationBefore ?? '?'} → est. ${head.utilizationAfter ?? '?'})`;
  return changes.length === 1
    ? pattern
    : locale === 'zh'
      ? `${pattern} 等 ${changes.length} 处截面调整`
      : `${pattern} and ${changes.length - 1} more section change(s)`;
}

/**
 * Wrap a design-provider proposal into a SkillDesignResult. When `approved`
 * is false the proposal is returned unapplied so the agent can present it to
 * the user for approval before adjusting the model.
 */
export function buildSkillDesignResultFromProvider(options: {
  providerResult: DesignProviderResult;
  iteration: number;
  maxIterations: number;
  approved: boolean;
  designSkillId?: string;
  costEstimate?: SkillDesignResult['costEstimate'];
  providerMeta?: Record<string, unknown>;
}): SkillDesignResult {
  const { providerResult } = options;
  const hasChanges = providerResult.changes.length > 0;
  const applied = hasChanges && options.approved;
  const action: DesignLoopAction = !hasChanges
    ? 'no_change'
    : applied
      ? 'iterate'
      : 'blocked_approval';
  return {
    provider: options.designSkillId ?? providerResult.provider,
    applied,
    action,
    iteration: options.iteration,
    maxIterations: options.maxIterations,
    converged: false,
    changes: providerResult.changes,
    ...(applied ? { model: providerResult.model } : {}),
    ...(providerResult.maxUtilizationBefore !== undefined ? { maxUtilizationBefore: providerResult.maxUtilizationBefore } : {}),
    ...(providerResult.maxUtilizationAfter !== undefined ? { maxUtilizationAfter: providerResult.maxUtilizationAfter } : {}),
    summary: {
      zh: summarizeDesignChanges(providerResult.changes, 'zh'),
      en: summarizeDesignChanges(providerResult.changes, 'en'),
    },
    ...(options.costEstimate !== undefined ? { costEstimate: options.costEstimate } : {}),
    ...(providerResult.notes.length > 0 || options.providerMeta
      ? {
          providerMeta: {
            ...(providerResult.notes.length > 0 ? { notes: providerResult.notes } : {}),
            ...(options.providerMeta ?? {}),
          },
        }
      : {}),
  };
}
