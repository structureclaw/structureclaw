import {
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLlmDraftPatch,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { projectEngineeringDraftToLegacyPatch } from '../../../agent-runtime/engineering-draft.js';
import { combineDomainKeys, composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
import { buildInteractionQuestions } from '../../../agent-runtime/fallback.js';
import { buildDefaultReportNarrative } from '../../../agent-runtime/report-template.js';
import { matchConservativeStructuralRoute } from '../../../agent-runtime/structural-routing.js';
import type { AppLocale } from '../../../services/locale.js';
import type {
  DraftExtraction,
  DraftIssue,
  DraftState,
  EngineeringDraft,
  EngineeringDraftLoad,
  InteractionQuestion,
  SkillDefaultProposal,
  SkillHandler,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';

const GEOMETRY_KEYS = ['lengthM'] as const;
const LOAD_BOUNDARY_KEYS = ['supportType', 'loadKN', 'loadType', 'loadPosition', 'loadPositionM'] as const;
const ALLOWED_KEYS = combineDomainKeys(GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS);

function beamNodeCoordinate(
  engineeringDraft: EngineeringDraft,
  target: string | undefined,
): number | undefined {
  if (!target) return undefined;
  const topologyNode = engineeringDraft.topology?.nodes?.find((node) => node.id.toLowerCase() === target.trim().toLowerCase());
  return topologyNode?.x;
}

function contradictoryPointLoadIssue(
  engineeringDraft: EngineeringDraft | undefined,
  locale: AppLocale,
): DraftIssue | undefined {
  if (!engineeringDraft) return undefined;
  for (const load of engineeringDraft.loads ?? []) {
    if ((load.kind !== 'point' && load.kind !== 'nodal') || load.location?.xM === undefined) continue;
    const targetX = beamNodeCoordinate(engineeringDraft, load.target);
    if (targetX === undefined || Math.abs(targetX - load.location.xM) <= 1e-6) continue;
    return {
      field: 'loadPosition',
      value: { target: load.target, xM: load.location.xM },
      severity: 'conflict',
      reason: locale === 'zh'
        ? `集中荷载目标 ${load.target} 与坐标 x=${load.location.xM}m 冲突。`
        : `Point-load target ${load.target} conflicts with coordinate x=${load.location.xM}m.`,
      question: locale === 'zh'
        ? '请确认集中荷载的目标节点或坐标。'
        : 'Please confirm the point-load node or coordinate.',
    };
  }
  return undefined;
}

function isContradictoryPointLoad(
  engineeringDraft: EngineeringDraft,
  load: EngineeringDraftLoad,
): boolean {
  if ((load.kind !== 'point' && load.kind !== 'nodal') || load.location?.xM === undefined) {
    return false;
  }
  const targetX = beamNodeCoordinate(engineeringDraft, load.target);
  return targetX !== undefined && Math.abs(targetX - load.location.xM) > 1e-6;
}

function isConsistentPointLoad(
  engineeringDraft: EngineeringDraft,
  load: EngineeringDraftLoad,
): boolean {
  if (load.kind !== 'point' && load.kind !== 'nodal') return false;
  const targetX = beamNodeCoordinate(engineeringDraft, load.target);
  return targetX !== undefined
    && (load.location?.xM === undefined || Math.abs(targetX - load.location.xM) <= 1e-6);
}

function sameBeamPointLoad(left: EngineeringDraftLoad, right: EngineeringDraftLoad): boolean {
  return left.kind === right.kind
    && left.unit === right.unit
    && left.direction === right.direction
    && left.target?.trim().toLowerCase() === right.target?.trim().toLowerCase()
    && Math.abs(left.magnitude - right.magnitude) <= 1e-9;
}

function withLegacyBeamPositionCorrection(
  existing: DraftState | undefined,
  patch: DraftExtraction,
): DraftState | undefined {
  const xM = patch.loadPositionM;
  const engineeringDraft = existing?.engineeringDraft;
  if (!engineeringDraft || xM === undefined || !Number.isFinite(xM) || xM < 0) {
    return existing;
  }
  let changed = false;
  const loads = engineeringDraft.loads?.map((load) => {
    if (!isContradictoryPointLoad(engineeringDraft, load)) return load;
    const targetX = beamNodeCoordinate(engineeringDraft, load.target);
    if (targetX === undefined || Math.abs(targetX - xM) > 1e-6) return load;
    changed = true;
    return {
      ...load,
      location: {
        ...(load.location ?? {}),
        xM,
      },
    };
  });
  if (!changed) return existing;
  return {
    ...existing,
    engineeringDraft: {
      ...engineeringDraft,
      loads,
    },
  };
}

function clearResolvedBeamLoadConflict(state: DraftState): DraftState {
  const engineeringDraft = state.engineeringDraft;
  if (!engineeringDraft?.loads?.length) return state;
  const loads = engineeringDraft.loads.filter((load, index, allLoads) => (
    !isContradictoryPointLoad(engineeringDraft, load)
    || !allLoads.some((candidate, candidateIndex) => (
      candidateIndex !== index
      && isConsistentPointLoad(engineeringDraft, candidate)
      && sameBeamPointLoad(load, candidate)
    ))
  ));
  const nextEngineeringDraft = loads.length === engineeringDraft.loads.length
    ? engineeringDraft
    : { ...engineeringDraft, loads };
  if (contradictoryPointLoadIssue(nextEngineeringDraft, 'en')) {
    return state;
  }

  const invalidDraftFields = Array.isArray(state.skillState?.invalidDraftFields)
    ? state.skillState.invalidDraftFields.filter((field) => field !== 'loadPosition')
    : undefined;
  const skillState = state.skillState
    ? {
      ...state.skillState,
      engineeringDraft: nextEngineeringDraft,
      beamLoads: loads.map((load) => ({
        kind: load.kind === 'line' || load.kind === 'distributed' || load.unit === 'kN/m'
          ? 'distributed'
          : 'point',
        magnitude: load.magnitude,
        unit: load.unit,
        direction: load.direction,
        target: load.target,
        xM: load.location?.xM,
        spanIndex: load.location?.spanIndex,
      })),
      invalidDraftFields: invalidDraftFields?.length ? invalidDraftFields : undefined,
    }
    : undefined;
  const draftIssues = state.draftIssues?.filter((issue) => (
    issue.field !== 'loadPosition' || issue.severity !== 'conflict'
  ));
  const resolvedPointLoad = loads.find((load) => isConsistentPointLoad(nextEngineeringDraft, load));
  const resolvedPointLoadX = resolvedPointLoad
    ? resolvedPointLoad.location?.xM ?? beamNodeCoordinate(nextEngineeringDraft, resolvedPointLoad.target)
    : undefined;
  return {
    ...state,
    engineeringDraft: nextEngineeringDraft,
    draftIssues: draftIssues?.length ? draftIssues : undefined,
    skillState,
    loadPositionM: resolvedPointLoadX ?? state.loadPositionM,
  };
}

function withBeamLoadConflict(patch: DraftExtraction, locale: AppLocale): DraftExtraction {
  const conflict = contradictoryPointLoadIssue(patch.engineeringDraft, locale);
  if (!conflict) return patch;
  const invalidDraftFields = Array.isArray(patch.skillState?.invalidDraftFields)
    ? patch.skillState.invalidDraftFields.filter((field): field is string => typeof field === 'string')
    : [];
  return {
    ...patch,
    draftIssues: [
      ...(patch.draftIssues ?? []).filter((issue) => issue.field !== conflict.field || issue.severity !== 'conflict'),
      conflict,
    ],
    skillState: {
      ...(patch.skillState ?? {}),
      invalidDraftFields: Array.from(new Set([...invalidDraftFields, 'loadPosition'])),
    },
  };
}

function applyBeamDefaults(patch: DraftExtraction): DraftExtraction {
  const nextPatch: DraftExtraction = { ...patch };

  if (
    nextPatch.loadPosition === undefined
    && nextPatch.loadType === 'distributed'
  ) {
    nextPatch.loadPosition = 'full-span';
  }

  return nextPatch;
}

function toBeamPatch(patch: DraftExtraction): DraftExtraction {
  const semanticPatch = projectEngineeringDraftToLegacyPatch(patch, 'beam');
  const domainPatch = composeStructuralDomainPatch({
    patch: semanticPatch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
  });
  const nextPatch = restrictLegacyDraftPatch(applyBeamDefaults(domainPatch), 'beam', [...ALLOWED_KEYS]);
  if (semanticPatch.engineeringDraft) {
    nextPatch.engineeringDraft = semanticPatch.engineeringDraft;
  }
  if (semanticPatch.skillState) {
    nextPatch.skillState = semanticPatch.skillState;
  }
  return nextPatch;
}

function buildBeamDefaultReason(paramKey: string, locale: AppLocale): string {
  switch (paramKey) {
    case 'supportType':
      return locale === 'zh'
        ? '默认按简支梁起步，便于先快速完成内力与变形首轮校核。'
        : 'Default to a simply-supported beam so the first-force and deflection check can run quickly.';
    case 'loadType':
      return locale === 'zh'
        ? '默认按均布荷载建模，更贴近梁构件常见受力工况。'
        : 'Default to a distributed load, which better matches common beam loading patterns.';
    case 'loadPosition':
      return locale === 'zh'
        ? '均布荷载默认作用于全跨，便于获得连续响应包络。'
        : 'For distributed loading, default to full-span action to obtain continuous response envelopes.';
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildBeamDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'beam' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) {
      continue;
    }
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildBeamDefaultReason(question.paramKey, locale),
    });
  }

  if (keys.includes('loadType')) {
    next.set('loadType', {
      paramKey: 'loadType',
      value: 'distributed',
      reason: buildBeamDefaultReason('loadType', locale),
    });
  }
  if (keys.includes('loadPosition')) {
    next.set('loadPosition', {
      paramKey: 'loadPosition',
      value: 'full-span',
      reason: buildBeamDefaultReason('loadPosition', locale),
    });
  }

  return Array.from(next.values());
}

function buildBeamQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'beam' }, locale).map((question) => {
    if (question.paramKey === 'supportType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '梁边界条件默认可按简支开始；若是悬臂或固接，请明确说明支座形式。'
          : 'You can start with simply-supported beam boundaries by default; specify if the beam is cantilever or fixed-ended.',
        suggestedValue: 'simply-supported',
      };
    }
    if (question.paramKey === 'loadType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认梁荷载形式（集中力 point / 均布荷载 distributed）。常规工况建议先用均布荷载。'
          : 'Please confirm beam load type (point / distributed). For typical cases, distributed load is recommended as the starting point.',
        suggestedValue: 'distributed',
      };
    }
    if (question.paramKey === 'loadPosition') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认梁荷载作用位置（跨中 midspan / 端部 end / 全跨 full-span）；均布荷载通常取全跨。'
          : 'Please confirm beam load position (midspan / end / full-span); for distributed load, full-span is usually preferred.',
        suggestedValue: 'full-span',
      };
    }
    return question;
  });
}

function buildBeamReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const beamSpecificNotes = [
    '',
    input.locale === 'zh' ? '## 梁专项说明' : '## Beam-Specific Notes',
    input.locale === 'zh'
      ? '- 梁模型结果对支座边界与荷载位置较敏感，建议优先复核支座形式与荷载作用区段。'
      : '- Beam results are sensitive to boundary conditions and load location; verify support assumptions and loaded segments first.',
    input.locale === 'zh'
      ? '- 若为连续梁、变截面梁或存在复杂连接，请补充更细分模型后再比较控制工况。'
      : '- For continuous beams, variable sections, or complex connections, refine the model before comparing governing cases.',
  ];
  return [base, ...beamSpecificNotes].join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale }) {
    const route = matchConservativeStructuralRoute(message);
    if (route?.skillId !== 'beam') {
      return null;
    }
    if (route.key === 'girder') {
      return buildStructuralTypeMatch('girder', 'beam', 'beam', 'fallback', locale, {
        zh: '已将“主梁/大梁”先按梁模板处理；若实际是连续梁或更复杂体系，请继续说明。',
        en: '“Girder” has been normalized to the beam template for now. If the actual system is continuous or more complex, please clarify further.',
      }, route.routingSource);
    }
    return buildStructuralTypeMatch('beam', 'beam', 'beam', route.supportLevel, locale, undefined, route.routingSource);
  },
  parseProvidedValues(values) {
    const patch = normalizeLegacyDraftPatch(values);
    return toBeamPatch(patch);
  },
  extractDraft({ locale, llmDraftPatch }) {
    const patch = toBeamPatch(normalizeLlmDraftPatch(llmDraftPatch));
    return withBeamLoadConflict(patch, locale);
  },
  mergeState(existing, patch) {
    const beamPatch = toBeamPatch(patch);
    const correctedExisting = withLegacyBeamPositionCorrection(existing, beamPatch);
    return clearResolvedBeamLoadConflict(
      mergeLegacyState(correctedExisting, beamPatch, 'beam', 'beam'),
    );
  },
  computeMissing(state, phase) {
    return computeLegacyMissing({ ...state, inferredType: 'beam' }, phase, [...ALLOWED_KEYS]);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildBeamQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildBeamDefaultProposals(keys, state, locale);
  },
  buildReportNarrative(input) {
    return buildBeamReportNarrative(input);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'beam' }, [...ALLOWED_KEYS]);
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
