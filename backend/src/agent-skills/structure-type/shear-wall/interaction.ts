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
  DEFAULT_REBAR_GRADE,
} from './constants.js';
import {
  buildShearWallDesignSummary,
  parseSeismicGrade,
  SEISMIC_GRADE_LABELS,
  suggestSeismicGradeFromIntensity,
} from './design.js';

export function computeShearWallMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult {
  const baseMissing = computeLegacyMissing({ ...state, inferredType: 'frame' }, phase, [...ALLOWED_KEYS]);

  const wallCriticalKeys: string[] = ['wallLengthM'];
  if (phase === 'interactive') {
    wallCriticalKeys.push('wallThicknessMm', 'wallConcreteGrade', 'wallRebarGrade');
  }
  for (const key of wallCriticalKeys) {
    if (state[key] === undefined && !baseMissing.critical.includes(key)) {
      baseMissing.critical.push(key);
    }
  }
  return baseMissing;
}

export function mapShearWallLabels(keys: string[], locale: AppLocale): string[] {
  return keys.map((key) => {
    switch (key) {
      case 'wallLengthM':
        return locale === 'zh' ? '剪力墙墙肢总长（m）' : 'Wall line total length (m)';
      case 'wallThicknessMm':
        return locale === 'zh' ? '墙厚（mm）' : 'Wall thickness (mm)';
      case 'wallConcreteGrade':
        return locale === 'zh' ? '墙身混凝土等级' : 'Wall concrete grade';
      case 'wallRebarGrade':
        return locale === 'zh' ? '墙身钢筋等级' : 'Wall rebar grade';
      case 'wallOpenings':
        return locale === 'zh' ? '墙上洞口（宽×高，m）' : 'Wall openings (width × height, m)';
      case 'seismicGrade':
        return locale === 'zh' ? '抗震等级（一级~四级）' : 'Seismic grade (1st–4th)';
      default:
        return buildLegacyLabels([key], locale)[0];
    }
  });
}

function suggestedThicknessMm(state: DraftState): number | undefined {
  const storyHeightsM = state.storyHeightsM;
  if (!storyHeightsM?.length) return undefined;
  const grade = parseSeismicGrade(state.seismicGrade)
    ?? suggestSeismicGradeFromIntensity(state.siteSeismic?.intensity);
  const summary = buildShearWallDesignSummary({
    wallLengthM: (typeof state.wallLengthM === 'number' && state.wallLengthM > 0) ? state.wallLengthM : 1,
    storyHeightsM,
    openings: [],
    seismicGrade: grade,
  });
  const interactive = summary.stories.find((story) => !story.isBottomStrengthenedZone) ?? summary.stories[0];
  return interactive?.thicknessMm;
}

function suggestedSeismicGrade(state: DraftState): string | undefined {
  const fromState = parseSeismicGrade(state.seismicGrade);
  if (fromState !== undefined) return SEISMIC_GRADE_LABELS[fromState];
  const fromIntensity = suggestSeismicGradeFromIntensity(state.siteSeismic?.intensity);
  return fromIntensity !== undefined ? SEISMIC_GRADE_LABELS[fromIntensity] : undefined;
}

function buildShearWallDefaultReason(paramKey: string, locale: AppLocale, state: DraftState): string {
  switch (paramKey) {
    case 'wallThicknessMm': {
      const suggested = suggestedThicknessMm(state);
      return locale === 'zh'
        ? `按 GB/T 50011 6.4.1 墙厚限值估算为 ${suggested ?? 200}mm。`
        : `Estimated as ${suggested ?? 200}mm from the GB/T 50011 6.4.1 wall thickness limits.`;
    }
    case 'wallConcreteGrade':
      return locale === 'zh'
        ? '默认采用 C30 混凝土。'
        : 'Default to C30 concrete.';
    case 'wallRebarGrade':
      return locale === 'zh'
        ? '默认采用 HRB400 钢筋。'
        : 'Default to HRB400 rebar.';
    case 'seismicGrade': {
      const suggested = suggestedSeismicGrade(state);
      return locale === 'zh'
        ? `按设防烈度与剪力墙结构高度段（GB/T 50011 表 6.1.2）建议抗震等级 ${suggested ?? '四级'}。`
        : `Suggested seismic grade ${suggested ?? 'fourth'} from the intensity and the shear-wall height band of GB/T 50011 table 6.1.2.`;
    }
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

export function buildShearWallDefaultProposals(
  keys: string[],
  state: DraftState,
  locale: AppLocale,
): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'frame' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) continue;
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildShearWallDefaultReason(question.paramKey, locale, state),
    });
  }

  if (keys.includes('wallThicknessMm')) {
    const suggested = suggestedThicknessMm(state);
    if (suggested !== undefined) {
      next.set('wallThicknessMm', {
        paramKey: 'wallThicknessMm',
        value: suggested,
        reason: buildShearWallDefaultReason('wallThicknessMm', locale, state),
      });
    }
  }
  if (keys.includes('wallConcreteGrade')) {
    next.set('wallConcreteGrade', {
      paramKey: 'wallConcreteGrade',
      value: DEFAULT_CONCRETE_GRADE,
      reason: buildShearWallDefaultReason('wallConcreteGrade', locale, state),
    });
  }
  if (keys.includes('wallRebarGrade')) {
    next.set('wallRebarGrade', {
      paramKey: 'wallRebarGrade',
      value: DEFAULT_REBAR_GRADE,
      reason: buildShearWallDefaultReason('wallRebarGrade', locale, state),
    });
  }
  if (keys.includes('seismicGrade')) {
    const suggested = suggestedSeismicGrade(state);
    if (suggested !== undefined) {
      next.set('seismicGrade', {
        paramKey: 'seismicGrade',
        value: suggested,
        reason: buildShearWallDefaultReason('seismicGrade', locale, state),
      });
    }
  }

  return Array.from(next.values());
}

export function buildShearWallQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'frame' }, locale).map((question) => {
    if (question.paramKey === 'wallLengthM') {
      return {
        ...question,
        label: locale === 'zh' ? '墙肢总长' : 'Wall line length',
        question: locale === 'zh'
          ? '请提供剪力墙墙肢总长（m）。洞口布置将按该总长展开。'
          : 'Please provide the shear wall line total length (m). Openings are laid out along this length.',
      };
    }
    if (question.paramKey === 'wallThicknessMm') {
      const suggested = suggestedThicknessMm(state);
      return {
        ...question,
        label: locale === 'zh' ? '墙厚' : 'Wall thickness',
        question: locale === 'zh'
          ? `请确认墙厚（mm）。${suggested ? `按 GB/T 50011 6.4.1 估算建议 ${suggested}mm。` : ''}`
          : `Please confirm the wall thickness (mm).${suggested ? ` Suggested ${suggested}mm per GB/T 50011 6.4.1.` : ''}`,
        suggestedValue: suggested,
      };
    }
    if (question.paramKey === 'wallConcreteGrade') {
      return {
        paramKey: 'wallConcreteGrade',
        label: locale === 'zh' ? '墙身混凝土等级' : 'Wall concrete grade',
        question: locale === 'zh'
          ? '请确认墙身混凝土等级（如 C30、C35、C40）。'
          : 'Please confirm the wall concrete grade (e.g. C30, C35, C40).',
        required: true,
        critical: criticalMissing.includes('wallConcreteGrade'),
        suggestedValue: DEFAULT_CONCRETE_GRADE,
      };
    }
    if (question.paramKey === 'wallRebarGrade') {
      return {
        paramKey: 'wallRebarGrade',
        label: locale === 'zh' ? '墙身钢筋等级' : 'Wall rebar grade',
        question: locale === 'zh'
          ? '请确认墙身钢筋等级（如 HRB400、HRB500）。'
          : 'Please confirm the wall rebar grade (e.g. HRB400, HRB500).',
        required: true,
        critical: criticalMissing.includes('wallRebarGrade'),
        suggestedValue: DEFAULT_REBAR_GRADE,
      };
    }
    if (question.paramKey === 'wallOpenings') {
      return {
        ...question,
        label: locale === 'zh' ? '墙上洞口' : 'Wall openings',
        question: locale === 'zh'
          ? '请提供墙上洞口信息（宽×高，m，可含 xM 偏移与 sillM 窗台高）。无洞口可直接确认。'
          : 'Please describe wall openings (width × height, m; optional xM offset and sillM sill height). Confirm if there are none.',
        suggestedValue: [],
      };
    }
    if (question.paramKey === 'seismicGrade') {
      const suggested = suggestedSeismicGrade(state);
      return {
        ...question,
        label: locale === 'zh' ? '抗震等级' : 'Seismic grade',
        question: locale === 'zh'
          ? `请确认抗震等级（一级~四级）。${suggested ? `按 GB/T 50011 表 6.1.2 建议 ${suggested}。` : ''}`
          : `Please confirm the seismic grade (1st–4th).${suggested ? ` Suggested ${suggested} per GB/T 50011 table 6.1.2.` : ''}`,
        suggestedValue: suggested,
      };
    }
    return question;
  });
}

export function buildShearWallReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const wallNotes = [
    '',
    input.locale === 'zh' ? '## 剪力墙专项说明' : '## Shear Wall-Specific Notes',
    input.locale === 'zh'
      ? '- 本模型按等效框架假定生成（墙肢 + 连梁），墙板应力细化建议采用壳元模型复核。'
      : '- The model uses the equivalent-frame assumption (wall piers + coupling beams); refine wall panel stresses with a shell-element model when needed.',
    input.locale === 'zh'
      ? '- 墙厚、连梁高度与分布钢筋按 GB/T 50011-2010（2024版）6.4 节估算，详细配筋需按 GB/T 50010 及 JGJ 3 复核。'
      : '- Wall thickness, coupling beam depth, and distributed reinforcement follow GB/T 50011-2010 (2024 edition) clause 6.4; verify detailing against GB/T 50010 and JGJ 3.',
    input.locale === 'zh'
      ? '- 抗震分析建议采用地震工作流（opensees-seismic），剪力墙结构弹性层间位移角限值 1/1000（框剪 1/800）。'
      : '- Use the seismic workflow (opensees-seismic); the elastic story drift limit is 1/1000 for shear wall structures (1/800 for frame-shear wall).',
  ];
  return [base, ...wallNotes].join('\n');
}

export function resolveShearWallStage(missingKeys: string[]): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report' {
  return resolveLegacyStructuralStage(missingKeys);
}
