import type {
  DraftExtraction,
  DraftState,
  InteractionQuestion,
  SkillDefaultProposal,
  SkillDetectionInput,
  SkillDraftContext,
  SkillHandler,
  SkillMissingResult,
  SkillReportNarrativeInput,
  StructuralTypeMatch,
} from '../../../agent-runtime/types.js';
import type { AppLocale } from '../../../services/locale.js';
import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import {
  buildQuestion,
  buildProposal,
  buildSectionModel,
  containsAny,
  extractNamedNumbers,
  localize,
  mergeSectionState,
  normalizeSectionText,
  parsePositiveNumber,
  parsePointList,
  parseString,
  pickSectionProfile,
  type SectionProfile,
} from '../shared.js';

type BridgeSectionType = 'box-girder' | 'plate-girder' | 'i-girder' | 't-girder' | 'composite-box';

interface BridgeGeometry {
  h?: number;
  b?: number;
  tw?: number;
  tf?: number;
  t?: number;
}

const BRIDGE_MODEL_WARNING = 'Bridge section defaults are baseline values and should be checked against deck layout and support conditions.';

const BRIDGE_PROFILES: SectionProfile[] = [
  {
    id: 'box-girder',
    aliases: ['box girder', 'box-girder', '钢箱梁', '箱梁', '桥箱梁', 'box beam'],
    label: { zh: '箱梁', en: 'Box girder' },
    description: { zh: '闭口桥梁主梁，抗扭性能更强。', en: 'Closed bridge girder with better torsional resistance.' },
    defaultGeometry: { h: 2200, b: 1200, t: 20 },
    requiredKeys: ['h', 'b', 't'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'depth', 'height', '梁高', '梁深'],
      b: ['b', 'width', '箱宽', '桥面宽'],
      t: ['t', 'thickness', '板厚', '壁厚'],
    },
    defaultMemberRole: 'girder',
  },
  {
    id: 'plate-girder',
    aliases: ['plate girder', 'plate-girder', '钢板梁', '板梁', '工字主梁'],
    label: { zh: '板梁', en: 'Plate girder' },
    description: { zh: '适用于中等跨度的桥梁主梁方案。', en: 'Suitable for medium-span bridge girder schemes.' },
    defaultGeometry: { h: 2000, b: 800, tw: 16, tf: 28 },
    requiredKeys: ['h', 'b', 'tw', 'tf'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'depth', 'height', '梁高'],
      b: ['b', 'width', '翼缘宽'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
    },
    defaultMemberRole: 'girder',
  },
  {
    id: 'i-girder',
    aliases: ['i girder', 'i-girder', '工字梁', 'i梁', 'beam girder', 'girder'],
    label: { zh: '工字梁', en: 'I-girder' },
    description: { zh: '适用于常规钢桥梁的开口主梁方案。', en: 'Open bridge girder option for standard steel bridges.' },
    defaultGeometry: { h: 1800, b: 700, tw: 14, tf: 25 },
    requiredKeys: ['h', 'b', 'tw', 'tf'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'depth', 'height', '梁高'],
      b: ['b', 'width', '翼缘宽'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
    },
    defaultMemberRole: 'girder',
  },
  {
    id: 't-girder',
    aliases: ['t girder', 't-girder', 't梁', 't beam'],
    label: { zh: 'T梁', en: 'T-girder' },
    description: { zh: '适合横向分配明显的桥梁主梁表达。', en: 'Suitable for bridge systems with strong transverse distribution characteristics.' },
    defaultGeometry: { h: 1600, b: 1000, tw: 18, tf: 30 },
    requiredKeys: ['h', 'b', 'tw', 'tf'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'depth', 'height', '梁高'],
      b: ['b', 'width', '翼缘宽'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
    },
    defaultMemberRole: 'girder',
  },
  {
    id: 'composite-box',
    aliases: ['composite box', 'composite-box', '组合箱梁', '组合梁箱', 'bridge composite box'],
    label: { zh: '组合箱梁', en: 'Composite box girder' },
    description: { zh: '组合桥梁的箱梁型截面表达。', en: 'Composite bridge superstructure represented as a box girder.' },
    defaultGeometry: { h: 2300, b: 1400, t: 22 },
    requiredKeys: ['h', 'b', 't'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'depth', 'height', '梁高'],
      b: ['b', 'width', '箱宽', '桥面宽'],
      t: ['t', 'thickness', '板厚', '壁厚'],
    },
    defaultMemberRole: 'girder',
  },
];

function pickBridgeProfile(message: string, state: DraftState | undefined): SectionProfile {
  const text = normalizeSectionText(message);
  const currentShape = parseString(state?.sectionType) as BridgeSectionType | undefined;
  if (currentShape) {
    const fromState = BRIDGE_PROFILES.find((profile) => profile.id === currentShape);
    if (fromState) {
      return fromState;
    }
  }
  return pickSectionProfile(text, BRIDGE_PROFILES) ?? BRIDGE_PROFILES[0];
}

function inferBridgeType(message: string, state: DraftState | undefined): BridgeSectionType {
  const text = normalizeSectionText(message);
  const fromState = parseString(state?.sectionType) as BridgeSectionType | undefined;
  if (fromState && BRIDGE_PROFILES.some((profile) => profile.id === fromState)) {
    return fromState;
  }
  if (containsAny(text, ['组合', 'composite'])) {
    return 'composite-box';
  }
  if (containsAny(text, ['箱梁', 'box', 'steel box', '钢箱梁'])) {
    return 'box-girder';
  }
  if (containsAny(text, ['板梁', 'plate', 'plate girder', '钢板梁'])) {
    return 'plate-girder';
  }
  if (containsAny(text, ['t梁', 't girder', 't-girder'])) {
    return 't-girder';
  }
  return 'i-girder';
}

function resolveBridgeType(message: string, values: Record<string, unknown>, state?: DraftState): BridgeSectionType {
  const explicit = parseString(values.sectionType) ?? parseString(values.shape) ?? parseString(values.profile);
  if (explicit) {
    const normalized = normalizeSectionText(explicit);
    const matched = BRIDGE_PROFILES.find((profile) => profile.id === normalized || profile.aliases.some((alias) => normalizeSectionText(alias) === normalized));
    if (matched) {
      return matched.id as BridgeSectionType;
    }
  }
  return inferBridgeType(message, state);
}

function inferBridgeMaterialFamily(message: string, values: Record<string, unknown>): 'steel' | 'concrete' | 'composite' {
  const text = normalizeSectionText(message);
  const explicit = parseString(values.materialFamily)?.toLowerCase();
  if (explicit === 'concrete' || explicit === 'steel' || explicit === 'composite') {
    return explicit;
  }
  if (containsAny(text, ['混凝土', 'concrete', 'prestressed', 'pc'])) {
    return 'concrete';
  }
  if (containsAny(text, ['组合', 'composite'])) {
    return 'composite';
  }
  return 'steel';
}

function inferBridgeMaterialGrade(family: 'steel' | 'concrete' | 'composite', values: Record<string, unknown>): string {
  const explicit = parseString(values.materialGrade) ?? parseString(values.grade);
  if (explicit) {
    return explicit;
  }
  if (family === 'concrete') {
    return 'C50';
  }
  return 'Q355';
}

function inferBridgeMaterialName(family: 'steel' | 'concrete' | 'composite', grade: string): { zh: string; en: string } {
  if (family === 'concrete') {
    return { zh: `${grade} 混凝土`, en: `${grade} concrete` };
  }
  if (family === 'composite') {
    return { zh: `${grade} 组合桥梁材料`, en: `${grade} composite bridge material` };
  }
  return { zh: `${grade} 钢材`, en: `${grade} steel` };
}

function parseBridgeGeometry(message: string, profile: SectionProfile, values: Record<string, unknown>): BridgeGeometry {
  const text = normalizeSectionText(message);
  const namedValues = extractNamedNumbers(text, profile.dimensionAliases);
  const geometry: BridgeGeometry = {};

  for (const key of Object.keys(profile.defaultGeometry)) {
    const numericValue = parsePositiveNumber(values[key]) ?? namedValues[key];
    if (numericValue !== undefined) {
      geometry[key as keyof BridgeGeometry] = numericValue;
    }
  }

  return {
    ...profile.defaultGeometry,
    ...geometry,
  };
}

function parseBridgeMeta(message: string, values: Record<string, unknown>): {
  spanLengthM: number;
  deckWidthM: number;
  girderCount: number;
  girderSpacingM: number;
} {
  const text = normalizeSectionText(message);
  const namedValues = extractNamedNumbers(text, {
    spanLengthM: ['span length', 'span', '跨径', '跨度', '桥跨'],
    deckWidthM: ['deck width', 'width', '桥面宽', '桥面宽度', '桥宽'],
    girderCount: ['girder count', 'girder number', 'girders', '梁数', '主梁数'],
    girderSpacingM: ['girder spacing', 'spacing', '梁间距', '主梁间距'],
  });

  const spanLengthM = parsePositiveNumber(values.spanLengthM) ?? namedValues.spanLengthM ?? 30;
  const deckWidthM = parsePositiveNumber(values.deckWidthM) ?? namedValues.deckWidthM ?? 12;
  const rawGirderCount = Math.round(parsePositiveNumber(values.girderCount) ?? namedValues.girderCount ?? 4);
  const girderCount = rawGirderCount >= 4 ? rawGirderCount : 4;
  const girderSpacingM = parsePositiveNumber(values.girderSpacingM) ?? namedValues.girderSpacingM ?? (girderCount > 1 ? deckWidthM / (girderCount - 1) : 3);

  return {
    spanLengthM,
    deckWidthM,
    girderCount,
    girderSpacingM,
  };
}

function buildBridgeModel(state: DraftState): Record<string, unknown> {
  const message = parseString(state.message) ?? '';
  const profile = pickBridgeProfile(message, state);
  const bridgeType = inferBridgeType(message, state);
  const materialFamily = inferBridgeMaterialFamily(message, state);
  const materialGrade = inferBridgeMaterialGrade(materialFamily, state);
  const materialName = inferBridgeMaterialName(materialFamily, materialGrade);
  const meta = parseBridgeMeta(message, state);
  const geometry = (state.geo as BridgeGeometry | undefined) ?? parseBridgeGeometry(message, profile, state);

  return buildSectionModel({
    skillId: 'section-bridge',
    family: 'bridge',
    title: { zh: '桥梁截面模型', en: 'Bridge section model' },
    sectionType: bridgeType,
    memberRole: 'girder',
    materialGrade,
    materialFamily,
    materialName,
    materialDensityKgM3: materialFamily === 'concrete' ? 2500 : 7850,
    geometry: {
      ...geometry,
      spanLengthM: meta.spanLengthM,
      deckWidthM: meta.deckWidthM,
      girderCount: meta.girderCount,
      girderSpacingM: meta.girderSpacingM,
    },
    spanLengthM: meta.spanLengthM,
    warnings: [BRIDGE_MODEL_WARNING],
    extras: {
      bridgeType,
      deckWidthM: meta.deckWidthM,
      girderCount: meta.girderCount,
      girderSpacingM: meta.girderSpacingM,
      supportScheme: 'bridge deck with longitudinal girder skeleton',
    },
  });
}

function buildBridgeNarrative(input: SkillReportNarrativeInput): string {
  if (input.locale === 'zh') {
    return [
      '## 桥梁截面说明',
      '- 已按桥梁语义接住请求，并优先补齐跨径、桥面宽度与主梁间距。',
      '- 默认模型会保留桥梁主梁的基础骨架，便于后续补充荷载、支座和施工阶段。',
      '- 若存在疲劳、横向分配或架设阶段约束，建议再补充专项条件。',
    ].join('\n');
  }

  return [
    '## Bridge Section Notes',
    '- The request has been captured as bridge-oriented, with span, deck width, and girder spacing prioritized.',
    '- The default model keeps a basic bridge girder skeleton so loads, supports, and construction stages can be added next.',
    '- If fatigue, transverse distribution, or erection-stage constraints exist, add dedicated conditions before validation.',
  ].join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale, currentState }: SkillDetectionInput): StructuralTypeMatch | null {
    const text = normalizeSectionText(message);
    if (!containsAny(text, ['bridge', '桥梁', '桥面', '桥墩', 'girder', '主梁', '箱梁', '板梁', '钢箱梁', 'plate girder'])) {
      return currentState?.skillId === 'section-bridge'
        ? buildStructuralTypeMatch(currentState.structuralTypeKey ?? 'bridge', currentState.inferredType ?? 'beam', 'section-bridge', currentState.supportLevel ?? 'fallback', locale, {
            zh: '继续沿用桥梁截面 skill 处理当前草稿。',
            en: 'Continue using the bridge section skill for the current draft.',
          })
        : null;
    }

    return buildStructuralTypeMatch('bridge', 'beam', 'section-bridge', 'supported', locale, {
      zh: '桥梁截面 skill 已激活。',
      en: 'The bridge section skill has been activated.',
    });
  },

  parseProvidedValues(values: Record<string, unknown>): DraftExtraction {
    const message = parseString(values.message) ?? '';
    const bridgeType = resolveBridgeType(message, values);
    const profile = BRIDGE_PROFILES.find((entry) => entry.id === bridgeType) ?? pickBridgeProfile(message, undefined);
    const geometry = parseBridgeGeometry(message, profile, values);
    const meta = parseBridgeMeta(message, values);
    const materialFamily = inferBridgeMaterialFamily(message, values);
    const materialGrade = inferBridgeMaterialGrade(materialFamily, values);

    return {
      skillId: 'section-bridge',
      inferredType: 'beam',
      structuralTypeKey: 'bridge',
      sectionType: bridgeType,
      memberRole: 'girder',
      materialFamily,
      materialGrade,
      materialName: inferBridgeMaterialName(materialFamily, materialGrade),
      geo: {
        ...geometry,
        spanLengthM: meta.spanLengthM,
        deckWidthM: meta.deckWidthM,
        girderCount: meta.girderCount,
        girderSpacingM: meta.girderSpacingM,
      },
      spanLengthM: meta.spanLengthM,
      deckWidthM: meta.deckWidthM,
      girderCount: meta.girderCount,
      girderSpacingM: meta.girderSpacingM,
      h: geometry.h,
      b: geometry.b,
      tw: geometry.tw,
      tf: geometry.tf,
      t: geometry.t,
      outlinePoints: parsePointList(values.outlinePoints ?? values.points ?? values.vertices),
    };
  },

  extractDraft(ctx: SkillDraftContext): DraftExtraction {
    const message = ctx.message ?? '';
    const profile = pickBridgeProfile(message, ctx.currentState);
    return this.parseProvidedValues({
      ...ctx.llmDraftPatch,
      message,
      sectionType: ctx.llmDraftPatch?.sectionType ?? ctx.currentState?.sectionType ?? profile.id,
      spanLengthM: ctx.currentState?.spanLengthM,
      deckWidthM: ctx.currentState?.deckWidthM,
      girderCount: ctx.currentState?.girderCount,
      girderSpacingM: ctx.currentState?.girderSpacingM,
      materialFamily: ctx.currentState?.materialFamily,
      materialGrade: ctx.currentState?.materialGrade,
      outlinePoints: ctx.llmDraftPatch?.outlinePoints ?? ctx.currentState?.outlinePoints,
    });
  },

  mergeState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
    return mergeSectionState(existing, patch, {
      inferredType: 'beam',
      skillId: 'section-bridge',
      structuralTypeKey: 'bridge',
      supportLevel: 'supported',
    });
  },

  computeMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult {
    const profile = BRIDGE_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? BRIDGE_PROFILES[0];
    const critical: string[] = [];
    const optional: string[] = [];

    if (!parseString(state.sectionType)) {
      critical.push('sectionType');
    }
    if (parsePositiveNumber(state.spanLengthM) === undefined) {
      critical.push('spanLengthM');
    }

    for (const key of profile.requiredKeys) {
      if (parsePositiveNumber(state[key]) === undefined) {
        critical.push(key);
      }
    }

    for (const key of ['deckWidthM', 'girderCount', 'girderSpacingM', 'materialFamily', 'materialGrade']) {
      if (parsePositiveNumber(state[key]) === undefined && key !== 'materialFamily' && key !== 'materialGrade') {
        optional.push(key);
      }
      if ((key === 'materialFamily' || key === 'materialGrade') && !parseString(state[key])) {
        optional.push(key);
      }
    }

    if (phase === 'execution' && parsePositiveNumber(state.girderCount) === undefined) {
      optional.push('girderCount');
    }

    return {
      critical: Array.from(new Set(critical)),
      optional: Array.from(new Set(optional)),
    };
  },

  mapLabels(keys: string[], locale: AppLocale): string[] {
    const labels: Record<string, string> = {
      sectionType: localize(locale, '桥梁类型', 'Bridge type'),
      spanLengthM: localize(locale, '桥跨长度 (m)', 'Bridge span (m)'),
      deckWidthM: localize(locale, '桥面宽度 (m)', 'Deck width (m)'),
      girderCount: localize(locale, '主梁数量', 'Girder count'),
      girderSpacingM: localize(locale, '主梁间距 (m)', 'Girder spacing (m)'),
      materialFamily: localize(locale, '材料体系', 'Material family'),
      materialGrade: localize(locale, '材料牌号', 'Material grade'),
      h: localize(locale, '梁高 h', 'Girder depth h'),
      b: localize(locale, '梁宽 b', 'Girder width b'),
      tw: localize(locale, '腹板厚度 tw', 'Web thickness tw'),
      tf: localize(locale, '翼缘厚度 tf', 'Flange thickness tf'),
      t: localize(locale, '板厚 t', 'Plate thickness t'),
    };
    return keys.map((key) => labels[key] ?? key);
  },

  buildQuestions(keys: string[], criticalMissing: string[], state: DraftState, locale: AppLocale): InteractionQuestion[] {
    const profile = BRIDGE_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? pickBridgeProfile('', state);
    return keys.map((paramKey) => {
      if (paramKey === 'sectionType') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '桥梁类型', en: 'Bridge type' },
          {
            zh: '请确认桥梁主梁类型，例如箱梁、板梁、工字梁或组合箱梁。',
            en: 'Please confirm the bridge girder type, such as box girder, plate girder, I-girder, or composite box girder.',
          },
          true,
          criticalMissing.includes(paramKey),
          profile.label,
        );
      }

      if (paramKey === 'spanLengthM') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '桥跨长度', en: 'Bridge span' },
          {
            zh: '请给出桥跨长度（m）。桥梁主梁设计通常需要这个值作为首要条件。',
            en: 'Please provide the bridge span in meters. This is usually the first control parameter for bridge girder design.',
          },
          true,
          true,
          state.spanLengthM ?? 30,
          'm',
        );
      }

      if (paramKey === 'deckWidthM') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '桥面宽度', en: 'Deck width' },
          {
            zh: '请给出桥面宽度（m），以便估算主梁数量与间距。',
            en: 'Please provide the deck width in meters so the girder count and spacing can be estimated.',
          },
          false,
          false,
          state.deckWidthM ?? 12,
          'm',
        );
      }

      if (paramKey === 'girderCount') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '主梁数量', en: 'Girder count' },
          {
            zh: '如果你已经确定主梁排布，请给出主梁数量；不确定时可先沿用默认建议。',
            en: 'If the girder arrangement is already fixed, please provide the girder count; otherwise the default recommendation can be used first.',
          },
          false,
          false,
          state.girderCount ?? 4,
        );
      }

      if (paramKey === 'girderSpacingM') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '主梁间距', en: 'Girder spacing' },
          {
            zh: '请给出主梁间距（m），或说明是否希望系统按桥面宽度自动建议。',
            en: 'Please provide the girder spacing in meters, or indicate whether you want the system to infer it from the deck width.',
          },
          false,
          false,
          state.girderSpacingM ?? 3,
          'm',
        );
      }

      if (paramKey === 'materialFamily') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '材料体系', en: 'Material family' },
          {
            zh: '请说明桥梁是钢桥、混凝土桥还是组合桥。',
            en: 'Please specify whether the bridge is steel, concrete, or composite.',
          },
          false,
          false,
          state.materialFamily ?? 'steel',
        );
      }

      if (paramKey === 'materialGrade') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '材料牌号', en: 'Material grade' },
          {
            zh: '请确认材料牌号；钢桥默认可先按 Q355，混凝土默认可先按 C50。',
            en: 'Please confirm the material grade. Steel bridges can start from Q355, while concrete bridges can start from C50.',
          },
          false,
          false,
          state.materialGrade ?? 'Q355',
        );
      }

      const geometryQuestionMap: Record<string, { label: { zh: string; en: string }; question: { zh: string; en: string }; unit: string }> = {
        h: {
          label: { zh: '梁高 h', en: 'Girder depth h' },
          question: { zh: '请给出主梁截面高度 h。', en: 'Please provide the girder depth h.' },
          unit: 'mm',
        },
        b: {
          label: { zh: '梁宽 b', en: 'Girder width b' },
          question: { zh: '请给出主梁截面宽度 b。', en: 'Please provide the girder width b.' },
          unit: 'mm',
        },
        tw: {
          label: { zh: '腹板厚度 tw', en: 'Web thickness tw' },
          question: { zh: '请给出腹板厚度 tw。', en: 'Please provide the web thickness tw.' },
          unit: 'mm',
        },
        tf: {
          label: { zh: '翼缘厚度 tf', en: 'Flange thickness tf' },
          question: { zh: '请给出翼缘厚度 tf。', en: 'Please provide the flange thickness tf.' },
          unit: 'mm',
        },
        t: {
          label: { zh: '板厚 t', en: 'Plate thickness t' },
          question: { zh: '请给出板厚 t。', en: 'Please provide the plate thickness t.' },
          unit: 'mm',
        },
      };

      const geometryQuestion = geometryQuestionMap[paramKey];
      return buildQuestion(
        locale,
        paramKey,
        geometryQuestion?.label ?? { zh: paramKey, en: paramKey },
        geometryQuestion?.question ?? {
          zh: `请补充 ${paramKey}。`,
          en: `Please provide ${paramKey}.`,
        },
        true,
        criticalMissing.includes(paramKey),
        profile.defaultGeometry[paramKey] ?? state[paramKey],
        geometryQuestion?.unit,
      );
    });
  },

  buildDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
    const message = parseString(state.message) ?? '';
    const spanLengthM = parsePositiveNumber(state.spanLengthM) ?? 30;
    const proposals: SkillDefaultProposal[] = [];
    const profile = BRIDGE_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? pickBridgeProfile(message, state);

    if (keys.includes('sectionType')) {
      const defaultType = containsAny(normalizeSectionText(message), ['组合'])
        ? 'composite-box'
        : containsAny(normalizeSectionText(message), ['箱梁', 'box'])
          ? 'box-girder'
          : spanLengthM >= 60
            ? 'box-girder'
            : spanLengthM >= 30
              ? 'plate-girder'
              : 'i-girder';
      proposals.push(buildProposal(locale, 'sectionType', defaultType, {
        zh: '根据桥梁跨度与常见工程做法，优先建议一个更稳妥的起始桥梁截面。',
        en: 'Based on the bridge span and common practice, use a more conservative starting bridge section.',
      }));
    }

    if (keys.includes('spanLengthM')) {
      proposals.push(buildProposal(locale, 'spanLengthM', spanLengthM, {
        zh: '如果当前消息没有明确跨径，先按 30m 作为常用桥梁主梁起点。',
        en: 'If no span is specified, start from a common 30 m bridge span baseline.',
      }));
    }

    if (keys.includes('deckWidthM')) {
      proposals.push(buildProposal(locale, 'deckWidthM', 12, {
        zh: '默认先按 12m 桥面宽度做起步估算。',
        en: 'Use 12 m as a pragmatic default deck width baseline.',
      }));
    }

    if (keys.includes('girderCount')) {
      proposals.push(buildProposal(locale, 'girderCount', 4, {
        zh: '默认先按 4 根主梁作为桥梁初始排布。',
        en: 'Start with 4 main girders as the initial bridge arrangement.',
      }));
    }

    if (keys.includes('girderSpacingM')) {
      proposals.push(buildProposal(locale, 'girderSpacingM', 3, {
        zh: '默认先按 3m 主梁间距作为常用起点。',
        en: 'Use 3 m as a common initial girder spacing.',
      }));
    }

    for (const key of profile.requiredKeys) {
      if (!keys.includes(key)) {
        continue;
      }
      const value = profile.defaultGeometry[key];
      if (value !== undefined) {
        proposals.push(buildProposal(locale, key, value, {
          zh: `使用 ${profile.label.zh} 的默认几何起点。`,
          en: `Use the default geometric starting point for ${profile.label.en}.`,
        }));
      }
    }

    if (keys.includes('materialFamily')) {
      proposals.push(buildProposal(locale, 'materialFamily', 'steel', {
        zh: '桥梁主梁默认先按钢桥处理。',
        en: 'Default to a steel bridge baseline first.',
      }));
    }

    if (keys.includes('materialGrade')) {
      proposals.push(buildProposal(locale, 'materialGrade', 'Q355', {
        zh: '钢桥默认先按 Q355 作为材料起点。',
        en: 'Q355 is a practical baseline for steel bridge members.',
      }));
    }

    return proposals;
  },

  buildReportNarrative(input: SkillReportNarrativeInput): string {
    return buildBridgeNarrative(input);
  },

  buildModel(state: DraftState): Record<string, unknown> | undefined {
    return buildBridgeModel(state);
  },

  resolveStage(missingKeys: string[], state: DraftState): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report' {
    if (missingKeys.includes('sectionType') || missingKeys.includes('spanLengthM')) {
      return 'intent';
    }
    if (missingKeys.some((key) => ['h', 'b', 'tw', 'tf', 't'].includes(key))) {
      return 'model';
    }
    if (!parseString(state.materialFamily) || !parseString(state.materialGrade)) {
      return 'model';
    }
    return 'analysis';
  },
};

export default handler;
