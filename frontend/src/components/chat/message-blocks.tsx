'use client';

import type { MessageKey } from '@/lib/i18n';

// --- Block Types ---

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export type ToolCallDetail = {
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
};

export type StepBlock = {
  type: 'step';
  stepId: string;
  tool: string;
  provides?: string;
  reason: string;
  status: StepStatus;
  durationMs?: number;
  error?: string;
  toolCallDetail?: ToolCallDetail;
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

export function enrichBlocksWithToolCalls(
  blocks: BlocksState,
  toolCalls: Array<{ tool: string; input?: Record<string, unknown>; output?: unknown; error?: string }>,
): BlocksState {
  return blocks.map(block => {
    if (block.type !== 'phase') return block;
    return {
      ...block,
      steps: block.steps.map(step => {
        // Match by tool name; if multiple calls for same tool, take the last one
        const match = toolCalls.filter(tc => tc.tool === step.tool).pop();
        if (!match) return step;
        return {
          ...step,
          toolCallDetail: {
            input: match.input,
            output: match.output,
            error: match.error,
          },
        };
      }),
    };
  });
}

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatJsonBrief(data: unknown, maxLen = 200): string {
  if (!data || typeof data !== 'object') return '';
  try {
    const str = JSON.stringify(data, null, 0);
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
  } catch {
    return '';
  }
}

export function StepBlockView({ step, t }: { step: StepBlock; t: (key: MessageKey) => string }) {
  const label = t(stepLabelKey(step.tool));
  const [expanded, setExpanded] = useState(false);
  const hasDetail = step.toolCallDetail && (step.toolCallDetail.output || step.toolCallDetail.error);
  const outputBrief = step.toolCallDetail?.output ? formatJsonBrief(step.toolCallDetail.output) : null;

  return (
    <div className="py-1 text-sm">
      <div className="flex items-center gap-2">
        {step.status === 'done' && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        {step.status === 'running' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-400" />}
        {step.status === 'pending' && <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/40" />}
        {step.status === 'error' && <X className="h-3.5 w-3.5 shrink-0 text-rose-500" />}
        <span className={cn(
          'flex-1',
          step.status === 'pending' && 'text-muted-foreground',
          step.status === 'done' && 'text-foreground',
          step.status === 'error' && 'text-rose-500',
        )}>
          {label}
        </span>
        {step.durationMs != null && (
          <span className="text-xs text-muted-foreground">
            {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {hasDetail && (
          <button
            type="button"
            className="ml-1 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        )}
      </div>
      {step.error && (
        <div className="ml-5 mt-0.5 text-xs text-rose-400 dark:text-rose-300">
          {step.error}
        </div>
      )}
      {outputBrief && !expanded && (
        <div className="ml-5 mt-0.5 truncate text-xs text-muted-foreground/70">
          {outputBrief}
        </div>
      )}
      {expanded && hasDetail && (
        <div className="ml-5 mt-1 space-y-1">
          {step.toolCallDetail!.output != null && (
            <details open>
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('promptThinkingToolOutput')}</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-black/5 p-2 text-xs dark:bg-white/5">
                {typeof step.toolCallDetail!.output === 'string'
                  ? (step.toolCallDetail!.output as string)
                  : JSON.stringify(step.toolCallDetail!.output, null, 2)}
              </pre>
            </details>
          )}
          {step.toolCallDetail!.input != null && Object.keys(step.toolCallDetail!.input).length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('promptThinkingToolInput')}</summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-black/5 p-2 text-xs dark:bg-white/5">
                {JSON.stringify(step.toolCallDetail!.input, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function PhaseBlockView({
  block,
  t,
  onToggleExpand,
}: {
  block: PhaseBlock;
  t: (key: MessageKey) => string;
  onToggleExpand: () => void;
}) {
  const statusLabel = block.status === 'running'
    ? t('phaseStatusRunning')
    : block.status === 'done'
      ? t('phaseStatusDone')
      : block.status === 'error'
        ? t('phaseStatusError')
        : t('phaseStatusPending');

  return (
    <div className="rounded-xl border border-border/50 bg-background/50 dark:border-white/5 dark:bg-white/[0.02]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={onToggleExpand}
      >
        {block.expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        {block.status === 'done' && <Check className="h-4 w-4 text-emerald-500" />}
        {block.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />}
        {block.status === 'error' && <X className="h-4 w-4 text-rose-500" />}
        {block.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />}
        <span className="flex-1 text-sm font-medium">{block.label}</span>
        <span className={cn(
          'text-xs',
          block.status === 'running' && 'text-cyan-400',
          block.status === 'done' && 'text-emerald-500',
          block.status === 'error' && 'text-rose-500',
          block.status === 'pending' && 'text-muted-foreground',
        )}>
          {statusLabel}
          {block.durationMs != null && ` (${(block.durationMs / 1000).toFixed(1)}s)`}
        </span>
      </button>
      {block.expanded && block.steps.length > 0 && (
        <div className="border-t border-border/30 px-4 py-1 dark:border-white/5">
          {block.steps.map(step => (
            <StepBlockView key={step.stepId} step={step} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TextBlockView({ content }: { content: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-7">{content}</div>;
}

export function MessageBlocksView({
  blocks,
  t,
}: {
  blocks: MessageBlock[];
  t: (key: MessageKey) => string;
}) {
  const [localBlocks, setLocalBlocks] = useState(blocks);

  useEffect(() => { setLocalBlocks(blocks); }, [blocks]);

  const toggleExpand = (index: number) => {
    setLocalBlocks(prev => prev.map((b, i) =>
      b.type === 'phase' && i === index
        ? { ...b, expanded: !b.expanded }
        : b
    ));
  };

  return (
    <div className="space-y-2">
      {localBlocks.map((block, i) =>
        block.type === 'phase'
          ? <PhaseBlockView key={block.phaseKey} block={block} t={t} onToggleExpand={() => toggleExpand(i)} />
          : <TextBlockView key={`text-${i}`} content={(block as TextBlock).content} />
      )}
    </div>
  );
}
