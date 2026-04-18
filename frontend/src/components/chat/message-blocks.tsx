'use client';

import type { MessageKey } from '@/lib/i18n';

// --- Block Types ---

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export type StepBlock = {
  type: 'step';
  stepId: string;
  tool: string;
  provides?: string;
  reason: string;
  status: StepStatus;
  durationMs?: number;
  error?: string;
};

export type PhaseStatus = 'pending' | 'running' | 'done' | 'error';

export type PhaseBlock = {
  type: 'phase';
  phaseKey: PhaseKey;
  label: string;
  status: PhaseStatus;
  steps: StepBlock[];
  expanded: boolean;
  durationMs?: number;
};

export type TextBlock = {
  type: 'text';
  content: string;
};

export type MessageBlock = PhaseBlock | TextBlock;

// --- Phase Mapping ---

export type PhaseKey = 'modeling' | 'analysis' | 'codeCheck' | 'report' | 'design' | 'fallback';

const ARTIFACT_TO_PHASE: Record<string, PhaseKey> = {
  designBasis: 'modeling',
  normalizedModel: 'modeling',
  analysisModel: 'modeling',
  analysisRaw: 'analysis',
  postprocessedResult: 'analysis',
  codeCheckResult: 'codeCheck',
  reportArtifact: 'report',
};

const TOOL_TO_PHASE: Record<string, PhaseKey> = {
  draft_model: 'modeling',
  update_model: 'modeling',
  convert_model: 'modeling',
  validate_model: 'modeling',
  enrich_model: 'modeling',
  run_analysis: 'analysis',
  postprocess_result: 'analysis',
  run_code_check: 'codeCheck',
  generate_report: 'report',
  synthesize_design: 'design',
};

export function phaseKeyForStep(step: { tool: string; provides?: string }): PhaseKey {
  if (step.provides && ARTIFACT_TO_PHASE[step.provides]) {
    return ARTIFACT_TO_PHASE[step.provides];
  }
  return TOOL_TO_PHASE[step.tool] ?? 'fallback';
}

export function phaseLabelKey(phaseKey: PhaseKey): MessageKey {
  const map: Record<PhaseKey, MessageKey> = {
    modeling: 'phaseLabelModeling',
    analysis: 'phaseLabelAnalysis',
    codeCheck: 'phaseLabelCodeCheck',
    report: 'phaseLabelReport',
    design: 'phaseLabelDesign',
    fallback: 'phaseLabelFallback',
  };
  return map[phaseKey];
}

export function stepLabelKey(tool: string): MessageKey {
  const map: Record<string, MessageKey> = {
    draft_model: 'stepToolDraftModel',
    update_model: 'stepToolUpdateModel',
    convert_model: 'stepToolConvertModel',
    validate_model: 'stepToolValidateModel',
    enrich_model: 'stepToolEnrichModel',
    run_analysis: 'stepToolRunAnalysis',
    postprocess_result: 'stepToolPostprocessResult',
    run_code_check: 'stepToolRunCodeCheck',
    generate_report: 'stepToolGenerateReport',
    synthesize_design: 'stepToolSynthesizeDesign',
  };
  return map[tool] ?? 'stepToolFallback';
}

// --- Block State Mutations (immutable) ---

export type BlocksState = MessageBlock[];

export function initBlocksFromPipelineStart(
  steps: Array<{ stepId: string; tool: string; provides?: string }>,
  t: (key: MessageKey) => string,
): BlocksState {
  const phases = new Map<PhaseKey, StepBlock[]>();
  const phaseOrder: PhaseKey[] = [];

  for (const s of steps) {
    const pk = phaseKeyForStep(s);
    if (!phases.has(pk)) {
      phases.set(pk, []);
      phaseOrder.push(pk);
    }
    phases.get(pk)!.push({
      type: 'step',
      stepId: s.stepId,
      tool: s.tool,
      provides: s.provides,
      reason: '',
      status: 'pending',
    });
  }

  const blocks: MessageBlock[] = phaseOrder.map((pk, idx) => ({
    type: 'phase' as const,
    phaseKey: pk,
    label: t(phaseLabelKey(pk)),
    status: (idx === 0 ? 'running' : 'pending') as PhaseStatus,
    steps: phases.get(pk)!,
    expanded: idx === 0,
  }));

  return blocks;
}

export function applyStepStart(blocks: BlocksState, stepId: string, stepInfo: { tool: string; provides?: string; reason: string }): BlocksState {
  return blocks.map(block => {
    if (block.type !== 'phase') return block;
    const stepIdx = block.steps.findIndex(s => s.stepId === stepId);
    if (stepIdx === -1) return block;
    return {
      ...block,
      status: 'running' as const,
      expanded: true,
      steps: block.steps.map((s, i) =>
        i === stepIdx
          ? { ...s, status: 'running' as const, reason: stepInfo.reason }
          : s
      ),
    };
  });
}

export function applyStepEnd(
  blocks: BlocksState,
  stepId: string,
  stepStatus: 'success' | 'error',
  durationMs?: number,
  error?: string,
): BlocksState {
  return blocks.map(block => {
    if (block.type !== 'phase') return block;
    const stepIdx = block.steps.findIndex(s => s.stepId === stepId);
    if (stepIdx === -1) return block;

    const updatedSteps = block.steps.map((s, i) =>
      i === stepIdx
        ? { ...s, status: (stepStatus === 'success' ? 'done' : 'error') as StepStatus, durationMs, error }
        : s
    );

    const phaseStillRunning = updatedSteps.some(s => s.status === 'running' || s.status === 'pending');
    const hasError = updatedSteps.some(s => s.status === 'error');

    return {
      ...block,
      status: phaseStillRunning
        ? 'running'
        : (hasError ? 'error' : 'done'),
      steps: updatedSteps,
    };
  });
}

export function collapseCompletedPhases(blocks: BlocksState): BlocksState {
  return blocks.map(block => {
    if (block.type !== 'phase') return block;
    if (block.status === 'done' || block.status === 'error') {
      return { ...block, expanded: false };
    }
    return block;
  });
}
