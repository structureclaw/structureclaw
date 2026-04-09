import type { AppLocale } from '../../../services/locale.js';
import {
  buildLegacyLabels,
  computeLegacyMissing,
} from '../../../agent-runtime/legacy.js';
import { buildInteractionQuestions } from '../../../agent-runtime/fallback.js';
import { resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
import { buildDefaultReportNarrative } from '../../../agent-runtime/report-template.js';
import type {
  DraftState,
  InteractionQuestion,
  SkillDefaultProposal,
  SkillMissingResult,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';
import { FRAME_MATERIAL_KEYS, REQUIRED_KEYS } from './constants.js';
import { getDefaultBeamSection, getDefaultColumnSection } from './model.js';
import { hasLateralYFloorLoad } from './extract-llm.js';

function inferFrameDimensionProposal(state: DraftState): '2d' | '3d' {
  if (state.frameDimension === '3d') return '3d';
  if ((state.bayCountY ?? 0) > 0) return '3d';
  if ((state.bayWidthsYM?.length ?? 0) > 0) return '3d';
  if (hasLateralYFloorLoad(state.floorLoads)) return '3d';
  return '2d';
}

function buildFrameDefaultReason(paramKey: string, locale: AppLocale, state: DraftState): string {
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;
  switch (paramKey) {
    case 'frameDimension': {
      const dimension = inferFrameDimensionProposal(state);
      if (dimension === '3d') {
        return locale === 'zh'
          ? '已识别到 Y 向信息或双向侧向荷载，默认按 3D 规则轴网框架继续补参。'
          : 'Y-direction information or bi-directional lateral loading is detected, so default to a 3D regular-grid frame.';
      }
      return locale === 'zh'
        ? '未发现明确 Y 向输入，默认按 2D 平面框架先完成首轮分析。'
        : 'No explicit Y-direction inputs were found, so default to a 2D planar frame for the first analysis round.';
    }
    case 'frameBaseSupportType':
      return locale === 'zh'
        ? '框架柱脚默认采用固定支座，便于获得更稳健的初始刚度评估。'
        : 'Default frame base support to fixed to obtain a stable initial stiffness assessment.';
    case 'frameMaterial':
      return locale === 'zh'
        ? '钢框架默认采用 Q355 钢材，符合 GB 50017 常规设计要求。'
        : 'Default steel grade Q355, compliant with GB 50017 standard design practice.';
    case 'frameColumnSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层框架规模，建议柱截面采用 ${getDefaultColumnSection(storyCount)}（GB/T 11263 热轧 H 型钢）。`
        : `For a ${storyCount}-story frame, the recommended column section is ${getDefaultColumnSection(storyCount)} (GB/T 11263 hot-rolled H-section).`;
    case 'frameBeamSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层框架规模，建议梁截面采用 ${getDefaultBeamSection(storyCount)}（GB/T 11263 热轧 H 型钢）。`
        : `For a ${storyCount}-story frame, the recommended beam section is ${getDefaultBeamSection(storyCount)} (GB/T 11263 hot-rolled H-section).`;
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

export function computeFrameMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult {
  return computeLegacyMissing(
    { ...state, inferredType: 'frame' },
    phase,
    [...REQUIRED_KEYS],
  );
}

export function mapFrameLabels(keys: string[], locale: AppLocale): string[] {
  return keys.map((key) => {
    switch (key) {
      case 'frameMaterial': return locale === 'zh' ? '钢材牌号' : 'Steel grade';
      case 'frameColumnSection': return locale === 'zh' ? '柱截面' : 'Column section';
      case 'frameBeamSection': return locale === 'zh' ? '梁截面' : 'Beam section';
      default: return buildLegacyLabels([key], locale)[0];
    }
  });
}

export function buildFrameDefaultProposals(
  keys: string[],
  state: DraftState,
  locale: AppLocale,
): SkillDefaultProposal[] {
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'frame' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) continue;
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildFrameDefaultReason(question.paramKey, locale, state),
    });
  }

  if (keys.includes('frameDimension')) {
    next.set('frameDimension', {
      paramKey: 'frameDimension',
      value: inferFrameDimensionProposal(state),
      reason: buildFrameDefaultReason('frameDimension', locale, state),
    });
  }
  if (keys.includes('frameBaseSupportType')) {
    next.set('frameBaseSupportType', {
      paramKey: 'frameBaseSupportType',
      value: 'fixed',
      reason: buildFrameDefaultReason('frameBaseSupportType', locale, state),
    });
  }
  if (keys.includes('frameMaterial')) {
    next.set('frameMaterial', {
      paramKey: 'frameMaterial',
      value: 'Q355',
      reason: buildFrameDefaultReason('frameMaterial', locale, state),
    });
  }
  if (keys.includes('frameColumnSection')) {
    next.set('frameColumnSection', {
      paramKey: 'frameColumnSection',
      value: getDefaultColumnSection(storyCount),
      reason: buildFrameDefaultReason('frameColumnSection', locale, state),
    });
  }
  if (keys.includes('frameBeamSection')) {
    next.set('frameBeamSection', {
      paramKey: 'frameBeamSection',
      value: getDefaultBeamSection(storyCount),
      reason: buildFrameDefaultReason('frameBeamSection', locale, state),
    });
  }

  return Array.from(next.values());
}

export function buildFrameQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  const inferredDimension = inferFrameDimensionProposal(state);
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;

  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'frame' }, locale).map((question) => {
    if (question.paramKey === 'frameDimension') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认框架维度（2d / 3d）。若有 Y 向跨数、Y 向跨度或双向水平荷载，建议选择 3d。'
          : 'Please confirm frame dimension (2d / 3d). If Y-direction bays/widths or bi-directional lateral loads exist, 3d is recommended.',
        suggestedValue: inferredDimension,
      };
    }
    if (question.paramKey === 'frameBaseSupportType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认柱脚边界（fixed / pinned）。常规首轮分析建议先按 fixed。'
          : 'Please confirm base support condition (fixed / pinned). For initial frame analysis, fixed is usually recommended.',
        suggestedValue: 'fixed',
      };
    }
    if (question.paramKey === 'floorLoads') {
      const loadHint = inferredDimension === '3d'
        ? (locale === 'zh' ? '请至少给出各层竖向荷载，并补充 X/Y 向水平荷载。' : 'At minimum provide vertical load per story, plus lateral loads in both X and Y.')
        : (locale === 'zh' ? '请至少给出各层竖向荷载，可按需补充一个方向的水平荷载。' : 'At minimum provide vertical load per story, and optionally one-direction lateral load.');
      return {
        ...question,
        question: locale === 'zh'
          ? `请确认各层总荷载（单位 kN）。该值为整层总荷载，程序会按该层节点数均匀分配到各节点。${loadHint}`
          : `Please confirm per-story total load (kN). This is the total load on each story, and it will be distributed equally to all nodes on that floor. ${loadHint}`,
      };
    }
    if (question.paramKey === 'frameMaterial') {
      return {
        paramKey: 'frameMaterial',
        label: locale === 'zh' ? '钢材牌号' : 'Steel grade',
        question: locale === 'zh'
          ? '请确认钢材牌号（如 Q355、Q345、Q235、S355）。钢框架通常采用 Q355。'
          : 'Please confirm the steel grade (e.g. Q355, Q345, Q235, S355). Q355 is common for steel frames.',
        required: true,
        critical: criticalMissing.includes('frameMaterial'),
        suggestedValue: 'Q355',
      };
    }
    if (question.paramKey === 'frameColumnSection') {
      const suggested = storyCount > 0 ? getDefaultColumnSection(storyCount) : undefined;
      return {
        paramKey: 'frameColumnSection',
        label: locale === 'zh' ? '柱截面' : 'Column section',
        question: locale === 'zh'
          ? `请确认柱截面规格（如 HW350X350）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the column section designation (e.g. HW350X350).${suggested ? ` Suggested: ${suggested}.` : ''}`,
        required: true,
        critical: criticalMissing.includes('frameColumnSection'),
        suggestedValue: suggested,
      };
    }
    if (question.paramKey === 'frameBeamSection') {
      const suggested = storyCount > 0 ? getDefaultBeamSection(storyCount) : undefined;
      return {
        paramKey: 'frameBeamSection',
        label: locale === 'zh' ? '梁截面' : 'Beam section',
        question: locale === 'zh'
          ? `请确认梁截面规格（如 HN400X200）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the beam section designation (e.g. HN400X200).${suggested ? ` Suggested: ${suggested}.` : ''}`,
        required: true,
        critical: criticalMissing.includes('frameBeamSection'),
        suggestedValue: suggested,
      };
    }
    return question;
  });
}

export function buildFrameReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const frameSpecificNotes = [
    '',
    input.locale === 'zh' ? '## 框架专项说明' : '## Frame-Specific Notes',
    input.locale === 'zh'
      ? '- 本报告按规则轴网框架草稿生成，建议结合实际结构布置复核边界条件与荷载路径。'
      : '- This report is generated from a regular-grid frame draft; verify boundary conditions and load paths against the actual structural layout.',
    input.locale === 'zh'
      ? '- 对于退台、缺跨或明显不规则框架，建议补充更细化模型后重新分析与校核。'
      : '- For setbacks, missing bays, or strongly irregular frames, refine the model and rerun analysis/code checks.',
  ];
  return [base, ...frameSpecificNotes].join('\n');
}

export function resolveFrameStage(missingKeys: string[]): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report' {
  return resolveLegacyStructuralStage(
    missingKeys.filter((key) => !FRAME_MATERIAL_KEYS.includes(key as typeof FRAME_MATERIAL_KEYS[number])),
  );
}
