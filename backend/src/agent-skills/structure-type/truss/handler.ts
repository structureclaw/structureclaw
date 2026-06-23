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
  DraftState,
  InteractionQuestion,
  SkillDefaultProposal,
  SkillHandler,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';

const GEOMETRY_KEYS = ['lengthM', 'heightM', 'bayCount'] as const;
const LOAD_BOUNDARY_KEYS = ['loadKN', 'loadType', 'loadPosition'] as const;
const TRUSS_SPECIFIC_KEYS = ['trussTopology'] as const;
const ALLOWED_KEYS = [...combineDomainKeys(GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS), ...TRUSS_SPECIFIC_KEYS];

function mergeTrussSkillState(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    ...patch,
  };
}

function appendInvalidField(patch: DraftExtraction, field: string): void {
  const current = Array.isArray(patch.skillState?.invalidDraftFields)
    ? patch.skillState.invalidDraftFields.filter((item): item is string => typeof item === 'string')
    : [];
  if (!current.includes(field)) {
    current.push(field);
  }
  patch.skillState = mergeTrussSkillState(patch.skillState, { invalidDraftFields: current });
}

function getInvalidFields(state: DraftState | DraftExtraction | undefined): string[] {
  const fields = state?.skillState?.invalidDraftFields;
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields.filter((item): item is string => typeof item === 'string');
}

function validPatchFields(patch: DraftExtraction): string[] {
  const fields: string[] = [];
  for (const field of ['lengthM', 'heightM', 'bayCount', 'loadKN'] as const) {
    if (typeof patch[field] === 'number' && Number.isFinite(patch[field]) && patch[field] > 0) {
      fields.push(field);
    }
  }
  if (patch.skillState?.trussTopology && !patch.skillState.trussTopologyConflict) {
    fields.push('trussTopology');
  }
  return fields;
}

function reconcileInvalidFields(state: DraftState, patch: DraftExtraction): DraftState {
  const clearedFields = new Set(validPatchFields(patch));
  if (clearedFields.size === 0) {
    return state;
  }
  const invalidDraftFields = getInvalidFields(state).filter((field) => !clearedFields.has(field));
  return {
    ...state,
    skillState: {
      ...(state.skillState ?? {}),
      invalidDraftFields,
    },
  };
}

function applyTrussSanity(patch: DraftExtraction): DraftExtraction {
  const next: DraftExtraction = { ...patch };

  if (next.lengthM !== undefined && next.lengthM <= 0) {
    next.lengthM = undefined;
    appendInvalidField(next, 'lengthM');
  }
  if (next.heightM !== undefined && next.heightM <= 0) {
    next.heightM = undefined;
    appendInvalidField(next, 'heightM');
  }
  if (next.bayCount !== undefined && next.bayCount < 2) {
    next.bayCount = undefined;
    appendInvalidField(next, 'bayCount');
  }
  if (next.loadKN !== undefined && next.loadKN <= 0) {
    next.loadKN = undefined;
    appendInvalidField(next, 'loadKN');
  }

  if (next.lengthM !== undefined && next.heightM !== undefined) {
    const spanToHeight = next.lengthM / next.heightM;
    if (spanToHeight < 2 || spanToHeight > 20) {
      next.heightM = undefined;
      appendInvalidField(next, 'heightM');
    }
  }
  if (next.lengthM !== undefined && next.bayCount !== undefined) {
    const panelLength = next.lengthM / next.bayCount;
    if (next.bayCount > 30 || panelLength < 0.25) {
      next.bayCount = undefined;
      appendInvalidField(next, 'bayCount');
    }
  }
  if (next.loadKN !== undefined && next.loadKN > 5000) {
    next.loadKN = undefined;
    appendInvalidField(next, 'loadKN');
  }

  return next;
}

function toTrussPatch(patch: DraftExtraction): DraftExtraction {
  const semanticPatch = projectEngineeringDraftToLegacyPatch(patch, 'truss');
  const domainPatch = composeStructuralDomainPatch({
    patch: semanticPatch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
  });
  const nextPatch = restrictLegacyDraftPatch(domainPatch, 'truss', [...ALLOWED_KEYS]);
  if (semanticPatch.engineeringDraft) {
    nextPatch.engineeringDraft = semanticPatch.engineeringDraft;
  }
  if (semanticPatch.skillState) {
    nextPatch.skillState = semanticPatch.skillState;
  }
  return applyTrussSanity(nextPatch);
}

function buildTrussDefaultReason(paramKey: string, locale: AppLocale): string {
  switch (paramKey) {
    case 'loadType':
      return locale === 'zh'
        ? '桁架默认采用节点集中力，符合杆系理想化输入方式。'
        : 'Default to nodal point load for truss systems, matching the idealized member-model input.';
    case 'loadPosition':
      return locale === 'zh'
        ? '默认作用在上弦节点，作为常见竖向工况的起步假定。'
        : 'Default to top-chord nodes as a common starting assumption for vertical loading cases.';
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildTrussDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'truss' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) {
      continue;
    }
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildTrussDefaultReason(question.paramKey, locale),
    });
  }

  if (keys.includes('loadType')) {
    next.set('loadType', {
      paramKey: 'loadType',
      value: 'point',
      reason: buildTrussDefaultReason('loadType', locale),
    });
  }
  if (keys.includes('loadPosition')) {
    next.set('loadPosition', {
      paramKey: 'loadPosition',
      value: 'top-nodes',
      reason: buildTrussDefaultReason('loadPosition', locale),
    });
  }

  return Array.from(next.values());
}

function buildTrussQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'truss' }, locale).map((question) => {
    if (question.paramKey === 'loadType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认桁架荷载形式（point / distributed）。桁架通常优先按节点集中力 point 输入。'
          : 'Please confirm truss load type (point / distributed). Trusses are typically input as nodal point loads first.',
        suggestedValue: 'point',
      };
    }
    if (question.paramKey === 'heightM') {
      return {
        ...question,
        label: locale === 'zh' ? '桁架高度' : 'Truss height',
        question: locale === 'zh'
          ? '请确认桁架高度；若前面给出的高度为 0 或与跨度比例明显异常，请重新给出合理高度。'
          : 'Please confirm the truss height. If the previous height was zero or clearly inconsistent with the span, provide a realistic height.',
      };
    }
    if (question.paramKey === 'bayCount') {
      return {
        ...question,
        label: locale === 'zh' ? '桁架节间数' : 'Truss panel count',
        question: locale === 'zh'
          ? '请确认桁架节间数；节间数应至少为 2，且单个节间长度应保持合理。'
          : 'Please confirm the truss panel count. It should be at least 2 and keep each panel length realistic.',
      };
    }
    if (question.paramKey === 'trussTopology') {
      return {
        ...question,
        label: locale === 'zh' ? '桁架腹杆体系' : 'Truss web system',
        question: locale === 'zh'
          ? '请确认桁架腹杆布置；桁架通常需要腹杆形成稳定三角体系，若无腹杆应改按其他结构体系处理。'
          : 'Please confirm the truss web layout. A truss normally needs web members to form a stable triangulated system; if there are no web members, use a different structural system.',
      };
    }
    if (question.paramKey === 'loadPosition') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认荷载位置（top-nodes / middle-joint / free-joint）。常规竖向工况建议先用 top-nodes。'
          : 'Please confirm load position (top-nodes / middle-joint / free-joint). For common vertical cases, start with top-nodes.',
        suggestedValue: 'top-nodes',
      };
    }
    return question;
  });
}

function buildTrussReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const trussSpecificNotes = [
    '',
    input.locale === 'zh' ? '## 桁架专项说明' : '## Truss-Specific Notes',
    input.locale === 'zh'
      ? '- 桁架建议优先采用节点荷载与铰接理想化假定，复核杆件受拉受压分布是否符合预期。'
      : '- For trusses, prioritize nodal loads and pin-joint idealization; verify tension/compression distribution across members.',
    input.locale === 'zh'
      ? '- 若节点偏心、次杆参与受力或连接刚度不可忽略，建议升级为更细化杆系/实体模型。'
      : '- If joint eccentricity, secondary members, or connection stiffness are non-negligible, switch to a more refined truss/solid model.',
  ];
  return [base, ...trussSpecificNotes].join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale }) {
    const route = matchConservativeStructuralRoute(message);
    if (route?.skillId === 'truss') {
      return buildStructuralTypeMatch('truss', 'truss', 'truss', route.supportLevel, locale, undefined, route.routingSource);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toTrussPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ llmDraftPatch }) {
    return toTrussPatch(normalizeLlmDraftPatch(llmDraftPatch));
  },
  mergeState(existing, patch) {
    const trussPatch = toTrussPatch(patch);
    return reconcileInvalidFields(mergeLegacyState(existing, trussPatch, 'truss', 'truss'), trussPatch);
  },
  computeMissing(state, phase) {
    return computeLegacyMissing({ ...state, inferredType: 'truss' }, phase, [...ALLOWED_KEYS]);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildTrussQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildTrussDefaultProposals(keys, state, locale);
  },
  buildReportNarrative(input) {
    return buildTrussReportNarrative(input);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'truss' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
