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
import { REQUIRED_KEYS } from './constants.js';
import { getDefaultBeamSection, getDefaultColumnSection, hasConcreteFrameAnalysisLoadInput } from './model.js';
import { hasLateralYFloorLoad } from './extract-llm.js';

function inferConcreteFrameDimensionProposal(state: DraftState): '2d' | '3d' {
  if (state.frameDimension === '3d') return '3d';
  if ((state.bayCountY ?? 0) > 0) return '3d';
  if ((state.bayWidthsYM?.length ?? 0) > 0) return '3d';
  if (hasLateralYFloorLoad(state.floorLoads)) return '3d';
  return '2d';
}

function buildConcreteFrameDefaultReason(paramKey: string, locale: AppLocale, state: DraftState): string {
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;
  switch (paramKey) {
    case 'frameDimension': {
      const dimension = inferConcreteFrameDimensionProposal(state);
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
    case 'frameConcreteGrade':
      return locale === 'zh'
        ? '默认采用 C30 混凝土。'
        : 'Default to C30 concrete.';
    case 'frameRebarGrade':
      return locale === 'zh'
        ? '默认采用 HRB400 钢筋。'
        : 'Default to HRB400 rebar.';
    case 'frameColumnSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层框架规模，建议柱截面采用 ${getDefaultColumnSection(storyCount)}（矩形截面）。`
        : `For a ${storyCount}-story frame, the recommended column section is ${getDefaultColumnSection(storyCount)} (rectangular section).`;
    case 'frameBeamSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层框架规模，建议梁截面采用 ${getDefaultBeamSection(storyCount)}（矩形截面）。`
        : `For a ${storyCount}-story frame, the recommended beam section is ${getDefaultBeamSection(storyCount)} (rectangular section).`;
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

export function computeConcreteFrameMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult {
  // Get base critical keys from legacy computation
  const baseMissing = computeLegacyMissing(
    { ...state, inferredType: 'frame' },
    phase,
    [...REQUIRED_KEYS],
  );

  // Add material keys as critical for concrete frames in interactive phase
  if (phase === 'interactive') {
    const missingConcreteGrade = state.frameConcreteGrade === undefined;
    const missingRebarGrade = state.frameRebarGrade === undefined;
    const missingColumnSection = state.frameColumnSection === undefined;
    const missingBeamSection = state.frameBeamSection === undefined;

    if (missingConcreteGrade && !baseMissing.critical.includes('frameConcreteGrade')) {
      baseMissing.critical.push('frameConcreteGrade');
    }
    if (missingRebarGrade && !baseMissing.critical.includes('frameRebarGrade')) {
      baseMissing.critical.push('frameRebarGrade');
    }
    if (missingColumnSection && !baseMissing.critical.includes('frameColumnSection')) {
      baseMissing.critical.push('frameColumnSection');
    }
    if (missingBeamSection && !baseMissing.critical.includes('frameBeamSection')) {
      baseMissing.critical.push('frameBeamSection');
    }
  }

  if (!hasConcreteFrameAnalysisLoadInput(state)) return baseMissing;
  return {
    critical: baseMissing.critical.filter((key) => key !== 'floorLoads'),
    optional: baseMissing.optional.filter((key) => key !== 'floorLoads'),
  };
}

export function mapConcreteFrameLabels(keys: string[], locale: AppLocale): string[] {
  return keys.map((key) => {
    switch (key) {
      case 'frameConcreteGrade': return locale === 'zh' ? '混凝土等级' : 'Concrete grade';
      case 'frameRebarGrade': return locale === 'zh' ? '钢筋等级' : 'Rebar grade';
      case 'frameColumnSection': return locale === 'zh' ? '柱截面' : 'Column section';
      case 'frameBeamSection': return locale === 'zh' ? '梁截面' : 'Beam section';
      default: return buildLegacyLabels([key], locale)[0];
    }
  });
}

export function buildConcreteFrameDefaultProposals(
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
      reason: buildConcreteFrameDefaultReason(question.paramKey, locale, state),
    });
  }

  if (keys.includes('frameDimension')) {
    next.set('frameDimension', {
      paramKey: 'frameDimension',
      value: inferConcreteFrameDimensionProposal(state),
      reason: buildConcreteFrameDefaultReason('frameDimension', locale, state),
    });
  }
  if (keys.includes('frameBaseSupportType')) {
    next.set('frameBaseSupportType', {
      paramKey: 'frameBaseSupportType',
      value: 'fixed',
      reason: buildConcreteFrameDefaultReason('frameBaseSupportType', locale, state),
    });
  }
  // M1: Separate concrete and rebar grade
  if (keys.includes('frameConcreteGrade')) {
    next.set('frameConcreteGrade', {
      paramKey: 'frameConcreteGrade',
      value: 'C30',
      reason: buildConcreteFrameDefaultReason('frameConcreteGrade', locale, state),
    });
  }
  if (keys.includes('frameRebarGrade')) {
    next.set('frameRebarGrade', {
      paramKey: 'frameRebarGrade',
      value: 'HRB400',
      reason: buildConcreteFrameDefaultReason('frameRebarGrade', locale, state),
    });
  }
  if (keys.includes('frameColumnSection')) {
    next.set('frameColumnSection', {
      paramKey: 'frameColumnSection',
      value: getDefaultColumnSection(storyCount),
      reason: buildConcreteFrameDefaultReason('frameColumnSection', locale, state),
    });
  }
  if (keys.includes('frameBeamSection')) {
    next.set('frameBeamSection', {
      paramKey: 'frameBeamSection',
      value: getDefaultBeamSection(storyCount),
      reason: buildConcreteFrameDefaultReason('frameBeamSection', locale, state),
    });
  }

  return Array.from(next.values());
}

export function buildConcreteFrameQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  const inferredDimension = inferConcreteFrameDimensionProposal(state);
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;

  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'frame' }, locale).map((question) => {
    if (question.paramKey === 'frameDimension') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认框架维度（2d / 3d）。若有 Y 向跨数、Y 向跨度或双向水平荷载，建议选择 3d。二维框架按 X-Z 平面建模，Z 为竖向。'
          : 'Please confirm frame dimension (2d / 3d). If Y-direction bays/widths or bi-directional lateral loads exist, 3d is recommended. 2D frames use the X-Z plane with Z as vertical.',
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
    // M1: Separate concrete and rebar grade questions
    if (question.paramKey === 'frameConcreteGrade') {
      return {
        paramKey: 'frameConcreteGrade',
        label: locale === 'zh' ? '混凝土等级' : 'Concrete grade',
        question: locale === 'zh'
          ? '请确认混凝土等级（如 C30、C35、C40）。'
          : 'Please confirm the concrete grade (e.g. C30, C35, C40).',
        required: true,
        critical: criticalMissing.includes('frameConcreteGrade'),
        suggestedValue: 'C30',
      };
    }
    if (question.paramKey === 'frameRebarGrade') {
      return {
        paramKey: 'frameRebarGrade',
        label: locale === 'zh' ? '钢筋等级' : 'Rebar grade',
        question: locale === 'zh'
          ? '请确认钢筋等级（如 HRB400、HRB500）。'
          : 'Please confirm the rebar grade (e.g. HRB400, HRB500).',
        required: true,
        critical: criticalMissing.includes('frameRebarGrade'),
        suggestedValue: 'HRB400',
      };
    }
    if (question.paramKey === 'frameColumnSection') {
      const suggested = storyCount > 0 ? getDefaultColumnSection(storyCount) : undefined;
      return {
        paramKey: 'frameColumnSection',
        label: locale === 'zh' ? '柱截面' : 'Column section',
        question: locale === 'zh'
          ? `请确认柱截面规格（如 500X500 或 600X600）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the column section designation (e.g. 500X500 or 600X600).${suggested ? ` Suggested: ${suggested}.` : ''}`,
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
          ? `请确认梁截面规格（如 300X600 或 400X800）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the beam section designation (e.g. 300X600 or 400X800).${suggested ? ` Suggested: ${suggested}.` : ''}`,
        required: true,
        critical: criticalMissing.includes('frameBeamSection'),
        suggestedValue: suggested,
      };
    }
    return question;
  });
}

export function buildConcreteFrameReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const frameSpecificNotes = [
    '',
    input.locale === 'zh' ? '## 混凝土框架专项说明' : '## Concrete Frame-Specific Notes',
    input.locale === 'zh'
      ? '- 本报告按规则轴网钢筋混凝土框架草稿生成，建议结合实际结构布置复核边界条件与荷载路径。'
      : '- This report is generated from a regular-grid reinforced concrete frame draft; verify boundary conditions and load paths against the actual structural layout.',
    input.locale === 'zh'
      ? '- 对于退台、缺跨或明显不规则框架，建议补充更细化模型后重新分析与校核。'
      : '- For setbacks, missing bays, or strongly irregular frames, refine the model and rerun analysis/code checks.',
    input.locale === 'zh'
      ? '- 混凝土构件尺寸及配筋需按 GB/T 50010-2010（2024版）规范进行验算。'
      : '- Concrete member dimensions and reinforcement must be checked according to GB/T 50010-2010 (2024 edition) code.',
  ];
  return [base, ...frameSpecificNotes].join('\n');
}

export function resolveConcreteFrameStage(missingKeys: string[]): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report' {
  return resolveLegacyStructuralStage(missingKeys);
}
