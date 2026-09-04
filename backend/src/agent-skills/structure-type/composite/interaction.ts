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
import {
  ALLOWED_KEYS,
  DEFAULT_CONCRETE_GRADE,
  DEFAULT_STEEL_GRADE,
  DEFAULT_STUD_DIAMETER_MM,
} from './constants.js';
import {
  getDefaultCompositeBeamSection,
  getDefaultCompositeColumnSection,
} from './design.js';

const INTERACTIVE_CRITICAL_KEYS = [
  'compositeSlabThicknessMm',
  'compositeSteelBeamSection',
  'compositeSteelGrade',
  'compositeConcreteGrade',
] as const;

function resolveStoryCount(state: DraftState): number {
  return state.storyHeightsM?.length ?? (state.storyCount as number | undefined) ?? 0;
}

export function computeCompositeMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult {
  // The composite frame is modeled as a 2D elevation; pin the dimension so the
  // legacy frame rules demand bay geometry without asking 2d/3d questions.
  const baseMissing = computeLegacyMissing(
    { ...state, inferredType: 'frame', frameDimension: '2d' },
    phase,
    [...ALLOWED_KEYS],
  );
  if (phase === 'interactive') {
    for (const key of INTERACTIVE_CRITICAL_KEYS) {
      if (state[key] === undefined && !baseMissing.critical.includes(key)) {
        baseMissing.critical.push(key);
      }
    }
  }
  return baseMissing;
}

export function mapCompositeLabels(keys: string[], locale: AppLocale): string[] {
  return keys.map((key) => {
    switch (key) {
      case 'compositeSlabThicknessMm':
        return locale === 'zh' ? '混凝土板厚（mm）' : 'Concrete slab thickness (mm)';
      case 'compositeSlabWidthM':
        return locale === 'zh' ? '翼缘有效宽度（m）' : 'Effective flange width (m)';
      case 'compositeSteelBeamSection':
        return locale === 'zh' ? '组合梁钢梁截面' : 'Composite beam steel section';
      case 'compositeSteelColumnSection':
        return locale === 'zh' ? '钢柱截面' : 'Steel column section';
      case 'compositeSteelGrade':
        return locale === 'zh' ? '钢材牌号' : 'Steel grade';
      case 'compositeConcreteGrade':
        return locale === 'zh' ? '翼缘混凝土等级' : 'Flange concrete grade';
      case 'compositeStudDiameterMm':
        return locale === 'zh' ? '栓钉直径（mm）' : 'Shear stud diameter (mm)';
      default:
        return buildLegacyLabels([key], locale)[0];
    }
  });
}

function buildCompositeDefaultReason(paramKey: string, locale: AppLocale, state: DraftState): string {
  const storyCount = resolveStoryCount(state);
  switch (paramKey) {
    case 'compositeSlabThicknessMm':
      return locale === 'zh'
        ? '常规组合楼板板厚按 150mm 估算。'
        : 'Estimated at 150 mm from common composite floor slab practice.';
    case 'compositeSteelBeamSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层结构规模，建议钢梁截面采用 ${getDefaultCompositeBeamSection(storyCount)}（H 型钢）。`
        : `For a ${storyCount}-story structure, the suggested steel beam section is ${getDefaultCompositeBeamSection(storyCount)} (H profile).`;
    case 'compositeSteelColumnSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层结构规模，建议钢柱截面采用 ${getDefaultCompositeColumnSection(storyCount)}（H 型钢）。`
        : `For a ${storyCount}-story structure, the suggested steel column section is ${getDefaultCompositeColumnSection(storyCount)} (H profile).`;
    case 'compositeSteelGrade':
      return locale === 'zh'
        ? '默认采用 Q355 结构钢。'
        : 'Default to Q355 structural steel.';
    case 'compositeConcreteGrade':
      return locale === 'zh'
        ? '默认翼缘采用 C30 混凝土。'
        : 'Default the flange to C30 concrete.';
    case 'compositeStudDiameterMm':
      return locale === 'zh'
        ? '默认采用 φ19 圆柱头栓钉。'
        : 'Default to 19 mm headed shear studs.';
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

export function buildCompositeDefaultProposals(
  keys: string[],
  state: DraftState,
  locale: AppLocale,
): SkillDefaultProposal[] {
  const storyCount = resolveStoryCount(state);
  const questions = buildInteractionQuestions(
    keys,
    [],
    { ...state, inferredType: 'frame', frameDimension: '2d' },
    locale,
  );
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) continue;
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildCompositeDefaultReason(question.paramKey, locale, state),
    });
  }

  if (keys.includes('compositeSlabThicknessMm')) {
    next.set('compositeSlabThicknessMm', {
      paramKey: 'compositeSlabThicknessMm',
      value: 150,
      reason: buildCompositeDefaultReason('compositeSlabThicknessMm', locale, state),
    });
  }
  if (keys.includes('compositeSteelBeamSection')) {
    next.set('compositeSteelBeamSection', {
      paramKey: 'compositeSteelBeamSection',
      value: getDefaultCompositeBeamSection(storyCount),
      reason: buildCompositeDefaultReason('compositeSteelBeamSection', locale, state),
    });
  }
  if (keys.includes('compositeSteelColumnSection')) {
    next.set('compositeSteelColumnSection', {
      paramKey: 'compositeSteelColumnSection',
      value: getDefaultCompositeColumnSection(storyCount),
      reason: buildCompositeDefaultReason('compositeSteelColumnSection', locale, state),
    });
  }
  if (keys.includes('compositeSteelGrade')) {
    next.set('compositeSteelGrade', {
      paramKey: 'compositeSteelGrade',
      value: DEFAULT_STEEL_GRADE,
      reason: buildCompositeDefaultReason('compositeSteelGrade', locale, state),
    });
  }
  if (keys.includes('compositeConcreteGrade')) {
    next.set('compositeConcreteGrade', {
      paramKey: 'compositeConcreteGrade',
      value: DEFAULT_CONCRETE_GRADE,
      reason: buildCompositeDefaultReason('compositeConcreteGrade', locale, state),
    });
  }
  if (keys.includes('compositeStudDiameterMm')) {
    next.set('compositeStudDiameterMm', {
      paramKey: 'compositeStudDiameterMm',
      value: DEFAULT_STUD_DIAMETER_MM,
      reason: buildCompositeDefaultReason('compositeStudDiameterMm', locale, state),
    });
  }

  return Array.from(next.values());
}

export function buildCompositeQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  const storyCount = resolveStoryCount(state);

  return buildInteractionQuestions(
    keys,
    criticalMissing,
    { ...state, inferredType: 'frame', frameDimension: '2d' },
    locale,
  ).map((question) => {
    if (question.paramKey === 'compositeSlabThicknessMm') {
      return {
        paramKey: 'compositeSlabThicknessMm',
        label: locale === 'zh' ? '混凝土板厚' : 'Concrete slab thickness',
        question: locale === 'zh'
          ? '请确认组合梁混凝土翼缘板厚（mm）。未提供时建议按 150mm 估算。'
          : 'Please confirm the composite slab thickness (mm). Suggested 150 mm when not provided.',
        unit: 'mm',
        required: true,
        critical: criticalMissing.includes('compositeSlabThicknessMm'),
        suggestedValue: 150,
      };
    }
    if (question.paramKey === 'compositeSlabWidthM') {
      return {
        ...question,
        label: locale === 'zh' ? '翼缘有效宽度' : 'Effective flange width',
        question: locale === 'zh'
          ? '请确认翼缘有效宽度（m）。未提供时按 GB 50017 有效宽度规则自动推导。'
          : 'Please confirm the effective flange width (m). It is derived from the GB 50017 effective-width rule when omitted.',
      };
    }
    if (question.paramKey === 'compositeSteelBeamSection') {
      const suggested = storyCount > 0 ? getDefaultCompositeBeamSection(storyCount) : undefined;
      return {
        paramKey: 'compositeSteelBeamSection',
        label: locale === 'zh' ? '钢梁截面' : 'Steel beam section',
        question: locale === 'zh'
          ? `请确认组合梁钢梁截面（如 HN400X200 或 H400X200X8X13）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the steel beam profile (e.g. HN400X200 or H400X200X8X13).${suggested ? ` Suggested: ${suggested}.` : ''}`,
        required: true,
        critical: criticalMissing.includes('compositeSteelBeamSection'),
        suggestedValue: suggested,
      };
    }
    if (question.paramKey === 'compositeSteelColumnSection') {
      const suggested = storyCount > 0 ? getDefaultCompositeColumnSection(storyCount) : undefined;
      return {
        paramKey: 'compositeSteelColumnSection',
        label: locale === 'zh' ? '钢柱截面' : 'Steel column section',
        question: locale === 'zh'
          ? `请确认钢柱截面（如 HW300X300）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the steel column profile (e.g. HW300X300).${suggested ? ` Suggested: ${suggested}.` : ''}`,
        required: true,
        critical: criticalMissing.includes('compositeSteelColumnSection'),
        suggestedValue: suggested,
      };
    }
    if (question.paramKey === 'compositeSteelGrade') {
      return {
        paramKey: 'compositeSteelGrade',
        label: locale === 'zh' ? '钢材牌号' : 'Steel grade',
        question: locale === 'zh'
          ? '请确认钢材牌号（如 Q235、Q355、Q390）。'
          : 'Please confirm the steel grade (e.g. Q235, Q355, Q390).',
        required: true,
        critical: criticalMissing.includes('compositeSteelGrade'),
        suggestedValue: DEFAULT_STEEL_GRADE,
      };
    }
    if (question.paramKey === 'compositeConcreteGrade') {
      return {
        paramKey: 'compositeConcreteGrade',
        label: locale === 'zh' ? '翼缘混凝土等级' : 'Flange concrete grade',
        question: locale === 'zh'
          ? '请确认翼缘混凝土等级（如 C30、C40）。'
          : 'Please confirm the flange concrete grade (e.g. C30, C40).',
        required: true,
        critical: criticalMissing.includes('compositeConcreteGrade'),
        suggestedValue: DEFAULT_CONCRETE_GRADE,
      };
    }
    if (question.paramKey === 'compositeStudDiameterMm') {
      return {
        ...question,
        label: locale === 'zh' ? '栓钉直径' : 'Shear stud diameter',
        question: locale === 'zh'
          ? '请确认栓钉直径（mm），常用 φ16/φ19/φ22。'
          : 'Please confirm the shear stud diameter (mm); 16/19/22 mm are common.',
        suggestedValue: DEFAULT_STUD_DIAMETER_MM,
      };
    }
    return question;
  });
}

export function buildCompositeReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const compositeNotes = [
    '',
    input.locale === 'zh' ? '## 组合结构专项说明' : '## Composite-Specific Notes',
    input.locale === 'zh'
      ? '- 本模型按组合框架假定生成：钢梁截面承担分析内力，混凝土翼缘与栓钉布置以设计数据随构件输出，未单独划分板单元。'
      : '- The model uses the composite-frame assumption: the steel section carries the analysis forces, while the concrete flange and stud layout are attached as member design data (no shell elements).',
    input.locale === 'zh'
      ? '- 组合截面、有效翼缘宽度与栓钉数量按 GB 50017-2017 第14章估算；构件强度/稳定/挠度验算需按 GB 50017 校核流程复核，翼缘配筋按 GB/T 50010 复核。'
      : '- Composite sections, effective flange widths, and stud counts follow the GB 50017-2017 chapter 14 provisions; member strength/stability/deflection checks stay with the GB 50017 flow and flange reinforcement with GB/T 50010.',
    input.locale === 'zh'
      ? '- 当报告提示中和轴位于钢梁内（pnaInSteel）时，请加厚或加宽混凝土翼缘后重新复核。'
      : '- When the report flags the plastic neutral axis inside the steel (pnaInSteel), thicken or widen the concrete flange and re-check.',
  ];
  return [base, ...compositeNotes].join('\n');
}

export function resolveCompositeStage(missingKeys: string[]): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report' {
  return resolveLegacyStructuralStage(missingKeys);
}
