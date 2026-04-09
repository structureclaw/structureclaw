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

type IrregularSectionType = 'tapered-i' | 'tapered-box' | 'asymmetric-built-up' | 'section-with-opening' | 'polygon-custom';

interface IrregularGeometry {
  h?: number;
  b?: number;
  tw?: number;
  tf?: number;
  t?: number;
  hStart?: number;
  hEnd?: number;
  bStart?: number;
  bEnd?: number;
  webOffset?: number;
  openingWidth?: number;
  openingHeight?: number;
  openingPosition?: number;
}

const IRREGULAR_MODEL_WARNING = 'Irregular sections should be validated against fabrication limits, local buckling, and the exact outline definition.';

const IRREGULAR_PROFILES: SectionProfile[] = [
  {
    id: 'tapered-i',
    aliases: ['tapered i', 'tapered-i', '变截面工字钢', '变高工字钢', 'haunched i', 'haunch', 'tapered beam'],
    label: { zh: '变截面工字梁', en: 'Tapered I-beam' },
    description: { zh: '截面高度或翼缘宽度沿构件长度变化的工字梁。', en: 'I-beam whose depth or flange width varies along the member length.' },
    defaultGeometry: { hStart: 1800, hEnd: 1500, bStart: 650, bEnd: 500, tw: 14, tf: 25 },
    requiredKeys: ['hStart', 'hEnd', 'bStart', 'bEnd', 'tw', 'tf'],
    optionalKeys: [],
    dimensionAliases: {
      hStart: ['h start', 'hstart', '起始高度', '梁高起点'],
      hEnd: ['h end', 'hend', '终止高度', '梁高终点'],
      bStart: ['b start', 'bstart', '起始宽度', '翼缘宽起点'],
      bEnd: ['b end', 'bend', '终止宽度', '翼缘宽终点'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
    },
    defaultMemberRole: 'beam',
  },
  {
    id: 'tapered-box',
    aliases: ['tapered box', 'tapered-box', '变截面箱梁', '变高箱梁', 'haunched box'],
    label: { zh: '变截面箱梁', en: 'Tapered box girder' },
    description: { zh: '梁高或箱宽变化的闭口箱梁截面。', en: 'Closed box girder with varying depth or width.' },
    defaultGeometry: { hStart: 2200, hEnd: 1800, bStart: 1400, bEnd: 1200, t: 22 },
    requiredKeys: ['hStart', 'hEnd', 'bStart', 'bEnd', 't'],
    optionalKeys: [],
    dimensionAliases: {
      hStart: ['h start', 'hstart', '起始高度', '梁高起点'],
      hEnd: ['h end', 'hend', '终止高度', '梁高终点'],
      bStart: ['b start', 'bstart', '起始宽度', '箱宽起点'],
      bEnd: ['b end', 'bend', '终止宽度', '箱宽终点'],
      t: ['t', 'thickness', '板厚', '壁厚'],
    },
    defaultMemberRole: 'girder',
  },
  {
    id: 'asymmetric-built-up',
    aliases: ['asymmetric built-up', 'asymmetric', '异形组合', '偏心截面', 'built-up', '非对称'],
    label: { zh: '非对称组合截面', en: 'Asymmetric built-up section' },
    description: { zh: '适用于偏心、非对称或组合焊接截面。', en: 'Useful for eccentric, asymmetric, or welded built-up sections.' },
    defaultGeometry: { h: 1600, b: 900, tw: 12, tf: 20, webOffset: 80 },
    requiredKeys: ['h', 'b', 'tw', 'tf', 'webOffset'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'height', 'depth', '梁高'],
      b: ['b', 'width', '翼缘宽'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
      webOffset: ['web offset', 'offset', '偏心', '腹板偏心'],
    },
    defaultMemberRole: 'beam',
  },
  {
    id: 'section-with-opening',
    aliases: ['opening', 'perforated', '开孔', '开洞', 'section with opening', 'hole'],
    label: { zh: '开孔截面', en: 'Section with opening' },
    description: { zh: '带开孔或减重孔洞的截面。', en: 'Section with openings or cut-outs for weight reduction or utility routing.' },
    defaultGeometry: { h: 1200, b: 600, tw: 12, tf: 20, openingWidth: 240, openingHeight: 240, openingPosition: 0.5 },
    requiredKeys: ['h', 'b', 'tw', 'tf', 'openingWidth', 'openingHeight'],
    optionalKeys: ['openingPosition'],
    dimensionAliases: {
      h: ['h', 'height', 'depth', '梁高'],
      b: ['b', 'width', '宽'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
      openingWidth: ['opening width', 'hole width', '孔宽', '孔洞宽'],
      openingHeight: ['opening height', 'hole height', '孔高', '孔洞高'],
      openingPosition: ['opening position', 'hole position', '孔位', '孔位置'],
    },
    defaultMemberRole: 'beam',
  },
  {
    id: 'polygon-custom',
    aliases: ['custom outline', 'polygon', '自定义轮廓', '轮廓', 'outline', 'custom section'],
    label: { zh: '自定义轮廓截面', en: 'Custom outline section' },
    description: { zh: '完全由点集或轮廓草图定义的自定义截面。', en: 'Custom section defined by points or an outline sketch.' },
    defaultGeometry: {},
    requiredKeys: ['outlinePoints'],
    optionalKeys: [],
    dimensionAliases: {},
    defaultMemberRole: 'custom',
  },
];

function pickIrregularProfile(message: string, state: DraftState | undefined): SectionProfile {
  const text = normalizeSectionText(message);
  const currentShape = parseString(state?.sectionType) as IrregularSectionType | undefined;
  if (currentShape) {
    const fromState = IRREGULAR_PROFILES.find((profile) => profile.id === currentShape);
    if (fromState) {
      return fromState;
    }
  }
  return pickSectionProfile(text, IRREGULAR_PROFILES) ?? IRREGULAR_PROFILES[0];
}

function inferIrregularType(message: string, state: DraftState | undefined): IrregularSectionType {
  const text = normalizeSectionText(message);
  const fromState = parseString(state?.sectionType) as IrregularSectionType | undefined;
  if (fromState && IRREGULAR_PROFILES.some((profile) => profile.id === fromState)) {
    return fromState;
  }
  if (containsAny(text, ['opening', '开孔', '开洞', 'hole'])) {
    return 'section-with-opening';
  }
  if (containsAny(text, ['box', '箱梁', '箱形', '箱梁']) && containsAny(text, ['tapered', '变截面', '变高', 'haunch'])) {
    return 'tapered-box';
  }
  if (containsAny(text, ['tapered', '变截面', '变高', 'haunch'])) {
    return 'tapered-i';
  }
  if (containsAny(text, ['asymmetric', '异形', '偏心', '非对称', 'built-up'])) {
    return 'asymmetric-built-up';
  }
  return 'polygon-custom';
}

function resolveIrregularType(message: string, values: Record<string, unknown>, state?: DraftState): IrregularSectionType {
  const explicit = parseString(values.sectionType) ?? parseString(values.shape) ?? parseString(values.profile);
  if (explicit) {
    const normalized = normalizeSectionText(explicit);
    const matched = IRREGULAR_PROFILES.find((profile) => profile.id === normalized || profile.aliases.some((alias) => normalizeSectionText(alias) === normalized));
    if (matched) {
      return matched.id as IrregularSectionType;
    }
  }
  return inferIrregularType(message, state);
}

function inferIrregularMaterialFamily(message: string, values: Record<string, unknown>): 'steel' | 'concrete' | 'composite' | 'timber' {
  const text = normalizeSectionText(message);
  const explicit = parseString(values.materialFamily)?.toLowerCase();
  if (explicit === 'steel' || explicit === 'concrete' || explicit === 'composite' || explicit === 'timber') {
    return explicit;
  }
  if (containsAny(text, ['木', 'timber', 'glulam'])) {
    return 'timber';
  }
  if (containsAny(text, ['混凝土', 'concrete', 'prestressed'])) {
    return 'concrete';
  }
  if (containsAny(text, ['组合', 'composite'])) {
    return 'composite';
  }
  return 'steel';
}

function inferIrregularMaterialGrade(family: 'steel' | 'concrete' | 'composite' | 'timber', values: Record<string, unknown>): string {
  const explicit = parseString(values.materialGrade) ?? parseString(values.grade);
  if (explicit) {
    return explicit;
  }
  if (family === 'concrete') {
    return 'C50';
  }
  if (family === 'timber') {
    return 'GL24';
  }
  return 'Q355';
}

function inferIrregularMaterialName(family: 'steel' | 'concrete' | 'composite' | 'timber', grade: string): { zh: string; en: string } {
  if (family === 'concrete') {
    return { zh: `${grade} 混凝土`, en: `${grade} concrete` };
  }
  if (family === 'timber') {
    return { zh: `${grade} 木材`, en: `${grade} timber` };
  }
  if (family === 'composite') {
    return { zh: `${grade} 组合材料`, en: `${grade} composite material` };
  }
  return { zh: `${grade} 钢材`, en: `${grade} steel` };
}

function parseIrregularGeometry(message: string, profile: SectionProfile, values: Record<string, unknown>): IrregularGeometry {
  const text = normalizeSectionText(message);
  const namedValues = extractNamedNumbers(text, profile.dimensionAliases);
  const geometry: IrregularGeometry = {};

  for (const key of Object.keys(profile.defaultGeometry)) {
    const numericValue = parsePositiveNumber(values[key]) ?? namedValues[key];
    if (numericValue !== undefined) {
      geometry[key as keyof IrregularGeometry] = numericValue;
    }
  }

  return {
    ...profile.defaultGeometry,
    ...geometry,
  };
}

function deriveIrregularGeometry(sectionType: IrregularSectionType, geometry: IrregularGeometry): Record<string, unknown> {
  if (sectionType === 'tapered-i') {
    const h = geometry.h ?? ((geometry.hStart ?? 0) + (geometry.hEnd ?? 0)) / 2;
    const b = geometry.b ?? ((geometry.bStart ?? 0) + (geometry.bEnd ?? 0)) / 2;
    return {
      ...geometry,
      h,
      b,
    };
  }

  if (sectionType === 'tapered-box') {
    const h = geometry.h ?? ((geometry.hStart ?? 0) + (geometry.hEnd ?? 0)) / 2;
    const b = geometry.b ?? ((geometry.bStart ?? 0) + (geometry.bEnd ?? 0)) / 2;
    return {
      ...geometry,
      h,
      b,
    };
  }

  if (sectionType === 'asymmetric-built-up') {
    return {
      ...geometry,
      h: geometry.h,
      b: geometry.b,
    };
  }

  if (sectionType === 'section-with-opening') {
    return {
      ...geometry,
      h: geometry.h,
      b: geometry.b,
    };
  }

  return geometry as Record<string, unknown>;
}

function parseIrregularMeta(message: string, values: Record<string, unknown>): { spanLengthM: number; outlinePoints?: Array<{ x: number; y: number }> } {
  const text = normalizeSectionText(message);
  const namedValues = extractNamedNumbers(text, {
    spanLengthM: ['span length', 'span', '构件长度', '长度'],
  });
  const spanLengthM = parsePositiveNumber(values.spanLengthM) ?? namedValues.spanLengthM ?? 6;
  const outlinePoints = parsePointList(values.outlinePoints ?? values.points ?? values.vertices);
  return { spanLengthM, outlinePoints };
}

function buildIrregularModel(state: DraftState): Record<string, unknown> {
  const message = parseString(state.message) ?? '';
  const profile = pickIrregularProfile(message, state);
  const sectionType = inferIrregularType(message, state);
  const materialFamily = inferIrregularMaterialFamily(message, state);
  const materialGrade = inferIrregularMaterialGrade(materialFamily, state);
  const materialName = inferIrregularMaterialName(materialFamily, materialGrade);
  const meta = parseIrregularMeta(message, state);
  const rawGeometry = (state.geo as IrregularGeometry | undefined) ?? parseIrregularGeometry(message, profile, state);
  const geometry = deriveIrregularGeometry(sectionType, rawGeometry);

  return buildSectionModel({
    skillId: 'section-irregular',
    family: 'irregular',
    title: { zh: '异形截面模型', en: 'Irregular section model' },
    sectionType,
    memberRole: parseString(state.memberRole) ?? profile.defaultMemberRole,
    materialGrade,
    materialFamily,
    materialName,
    materialDensityKgM3: materialFamily === 'timber' ? 450 : materialFamily === 'concrete' ? 2500 : 7850,
    geometry,
    outlinePoints: meta.outlinePoints,
    spanLengthM: meta.spanLengthM,
    warnings: [IRREGULAR_MODEL_WARNING],
    extras: {
      irregularType: sectionType,
      rawGeometry,
      outlineProvided: Boolean(meta.outlinePoints?.length),
    },
  });
}

function buildIrregularNarrative(input: SkillReportNarrativeInput): string {
  if (input.locale === 'zh') {
    return [
      '## 异形与变截面说明',
      '- 已接住不规则截面请求，并保留轮廓、变截面与开孔这三条常见路径。',
      '- 默认模型会先用可计算的平均几何近似，后续可用点集或草图替换。',
      '- 若涉及局部屈曲、开孔削弱或焊接拼装限制，建议再补充专项校核条件。',
    ].join('\n');
  }

  return [
    '## Irregular Section Notes',
    '- The request has been captured as an irregular section problem, with outline, taper, and opening workflows preserved.',
    '- The default model uses a computable averaged geometry first, then can be replaced with point-based outline data.',
    '- If local buckling, opening weakening, or fabrication limits apply, add dedicated verification conditions.',
  ].join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale, currentState }: SkillDetectionInput): StructuralTypeMatch | null {
    const text = normalizeSectionText(message);
    if (!containsAny(text, ['不规则', '变截面', '异形', '开孔', '开洞', 'tapered', 'haunch', 'asymmetric', 'custom', 'polygon', 'outline'])) {
      return currentState?.skillId === 'section-irregular'
        ? buildStructuralTypeMatch(currentState.structuralTypeKey ?? 'unknown', currentState.inferredType ?? 'unknown', 'section-irregular', currentState.supportLevel ?? 'fallback', locale, {
            zh: '继续沿用异形与变截面 skill 处理当前草稿。',
            en: 'Continue using the irregular section skill for the current draft.',
          })
        : null;
    }

    if (containsAny(text, ['梁', 'beam', 'girder', '主梁'])) {
      return buildStructuralTypeMatch('beam', 'beam', 'section-irregular', 'supported', locale, {
        zh: '已识别为梁类不规则截面请求。',
        en: 'The request has been identified as a beam-like irregular section.',
      });
    }
    if (containsAny(text, ['柱', 'column', 'frame', '框架'])) {
      return buildStructuralTypeMatch('frame', 'frame', 'section-irregular', 'supported', locale, {
        zh: '已识别为框架或柱类不规则截面请求。',
        en: 'The request has been identified as a frame or column irregular section.',
      });
    }

    return buildStructuralTypeMatch('unknown', 'unknown', 'section-irregular', 'fallback', locale, {
      zh: '已切换到异形与变截面 skill 先接住请求。',
      en: 'Switched to the irregular section skill to catch the request first.',
    });
  },

  parseProvidedValues(values: Record<string, unknown>): DraftExtraction {
    const message = parseString(values.message) ?? '';
    const sectionType = resolveIrregularType(message, values);
    const profile = IRREGULAR_PROFILES.find((entry) => entry.id === sectionType) ?? pickIrregularProfile(message, undefined);
    const geometry = parseIrregularGeometry(message, profile, values);
    const meta = parseIrregularMeta(message, values);
    const materialFamily = inferIrregularMaterialFamily(message, values);
    const materialGrade = inferIrregularMaterialGrade(materialFamily, values);

    return {
      skillId: 'section-irregular',
      inferredType: sectionType === 'polygon-custom' ? 'unknown' : 'beam',
      structuralTypeKey: sectionType === 'polygon-custom' ? 'unknown' : 'beam',
      sectionType,
      memberRole: parseString(values.memberRole) ?? profile.defaultMemberRole,
      materialFamily,
      materialGrade,
      materialName: inferIrregularMaterialName(materialFamily, materialGrade),
      geo: {
        ...geometry,
        spanLengthM: meta.spanLengthM,
      },
      spanLengthM: meta.spanLengthM,
      h: geometry.h,
      b: geometry.b,
      tw: geometry.tw,
      tf: geometry.tf,
      t: geometry.t,
      hStart: geometry.hStart,
      hEnd: geometry.hEnd,
      bStart: geometry.bStart,
      bEnd: geometry.bEnd,
      webOffset: geometry.webOffset,
      openingWidth: geometry.openingWidth,
      openingHeight: geometry.openingHeight,
      openingPosition: geometry.openingPosition,
      outlinePoints: meta.outlinePoints,
    };
  },

  extractDraft(ctx: SkillDraftContext): DraftExtraction {
    const message = ctx.message ?? '';
    const profile = pickIrregularProfile(message, ctx.currentState);
    return this.parseProvidedValues({
      ...ctx.llmDraftPatch,
      message,
      sectionType: ctx.llmDraftPatch?.sectionType ?? ctx.currentState?.sectionType ?? profile.id,
      spanLengthM: ctx.currentState?.spanLengthM,
      materialFamily: ctx.currentState?.materialFamily,
      materialGrade: ctx.currentState?.materialGrade,
      memberRole: ctx.currentState?.memberRole ?? profile.defaultMemberRole,
      outlinePoints: ctx.llmDraftPatch?.outlinePoints ?? ctx.currentState?.outlinePoints,
    });
  },

  mergeState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
    return mergeSectionState(existing, patch, {
      inferredType: 'unknown',
      skillId: 'section-irregular',
      structuralTypeKey: 'unknown',
      supportLevel: 'fallback',
    });
  },

  computeMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult {
    const profile = IRREGULAR_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? IRREGULAR_PROFILES[0];
    const critical: string[] = [];
    const optional: string[] = [];

    if (!parseString(state.sectionType)) {
      critical.push('sectionType');
    }

    if (profile.id === 'polygon-custom') {
      const hasOutline = Array.isArray(state.outlinePoints) && state.outlinePoints.length >= 3;
      if (!hasOutline) {
        critical.push('outlinePoints');
      }
    }

    for (const key of profile.requiredKeys) {
      if (key === 'outlinePoints') {
        continue;
      }
      if (parsePositiveNumber(state[key]) === undefined) {
        critical.push(key);
      }
    }

    if (!parseString(state.memberRole)) {
      optional.push('memberRole');
    }
    if (!parseString(state.materialFamily)) {
      optional.push('materialFamily');
    }
    if (!parseString(state.materialGrade)) {
      optional.push('materialGrade');
    }
    if (phase === 'execution' && parsePositiveNumber(state.spanLengthM) === undefined) {
      optional.push('spanLengthM');
    }

    return {
      critical: Array.from(new Set(critical)),
      optional: Array.from(new Set(optional)),
    };
  },

  mapLabels(keys: string[], locale: AppLocale): string[] {
    const labels: Record<string, string> = {
      sectionType: localize(locale, '截面类型', 'Section type'),
      memberRole: localize(locale, '构件角色', 'Member role'),
      materialFamily: localize(locale, '材料体系', 'Material family'),
      materialGrade: localize(locale, '材料牌号', 'Material grade'),
      spanLengthM: localize(locale, '构件长度 (m)', 'Member length (m)'),
      h: localize(locale, '截面高度 h', 'Section depth h'),
      b: localize(locale, '截面宽度 b', 'Section width b'),
      tw: localize(locale, '腹板厚度 tw', 'Web thickness tw'),
      tf: localize(locale, '翼缘厚度 tf', 'Flange thickness tf'),
      t: localize(locale, '板厚 t', 'Plate thickness t'),
      hStart: localize(locale, '起始高度', 'Start depth'),
      hEnd: localize(locale, '终止高度', 'End depth'),
      bStart: localize(locale, '起始宽度', 'Start width'),
      bEnd: localize(locale, '终止宽度', 'End width'),
      webOffset: localize(locale, '腹板偏心', 'Web offset'),
      openingWidth: localize(locale, '孔宽', 'Opening width'),
      openingHeight: localize(locale, '孔高', 'Opening height'),
      openingPosition: localize(locale, '孔位', 'Opening position'),
      outlinePoints: localize(locale, '轮廓点', 'Outline points'),
    };
    return keys.map((key) => labels[key] ?? key);
  },

  buildQuestions(keys: string[], criticalMissing: string[], state: DraftState, locale: AppLocale): InteractionQuestion[] {
    const profile = IRREGULAR_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? pickIrregularProfile('', state);
    return keys.map((paramKey) => {
      if (paramKey === 'sectionType') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '截面类型', en: 'Section type' },
          {
            zh: '请说明不规则截面属于哪一类：变截面、异形、开孔还是自定义轮廓。',
            en: 'Please specify which irregular section family applies: tapered, asymmetric, perforated, or custom outline.',
          },
          true,
          criticalMissing.includes(paramKey),
          profile.label,
        );
      }

      if (paramKey === 'outlinePoints') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '轮廓点', en: 'Outline points' },
          {
            zh: '如果你已经有轮廓草图，请直接给出点集；也可以先上传 JSON 或简要描述轮廓形状。',
            en: 'If you already have an outline sketch, please provide the point set directly; a JSON outline or concise shape description also works.',
          },
          true,
          true,
          state.outlinePoints,
        );
      }

      if (paramKey === 'memberRole') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '构件角色', en: 'Member role' },
          {
            zh: '请说明该截面是用于梁、柱、主梁还是其他构件，这会影响默认约束和建议。',
            en: 'Please clarify whether the section is for a beam, column, girder, or another member, because that affects the default assumptions and guidance.',
          },
          false,
          false,
          state.memberRole ?? profile.defaultMemberRole,
        );
      }

      if (paramKey === 'materialFamily') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '材料体系', en: 'Material family' },
          {
            zh: '请说明是钢、混凝土、组合还是木结构。',
            en: 'Please specify whether this is steel, concrete, composite, or timber.',
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
            zh: '请确认材料牌号；钢默认可先按 Q355，混凝土可先按 C50，木材可先按 GL24。',
            en: 'Please confirm the material grade. Steel can start from Q355, concrete from C50, and timber from GL24.',
          },
          false,
          false,
          state.materialGrade ?? 'Q355',
        );
      }

      const geometryQuestionMap: Record<string, { label: { zh: string; en: string }; question: { zh: string; en: string }; unit?: string }> = {
        h: { label: { zh: '截面高度 h', en: 'Section depth h' }, question: { zh: '请给出截面高度 h。', en: 'Please provide the section depth h.' }, unit: 'mm' },
        b: { label: { zh: '截面宽度 b', en: 'Section width b' }, question: { zh: '请给出截面宽度 b。', en: 'Please provide the section width b.' }, unit: 'mm' },
        tw: { label: { zh: '腹板厚度 tw', en: 'Web thickness tw' }, question: { zh: '请给出腹板厚度 tw。', en: 'Please provide the web thickness tw.' }, unit: 'mm' },
        tf: { label: { zh: '翼缘厚度 tf', en: 'Flange thickness tf' }, question: { zh: '请给出翼缘厚度 tf。', en: 'Please provide the flange thickness tf.' }, unit: 'mm' },
        t: { label: { zh: '板厚 t', en: 'Plate thickness t' }, question: { zh: '请给出板厚 t。', en: 'Please provide the plate thickness t.' }, unit: 'mm' },
        hStart: { label: { zh: '起始高度', en: 'Start depth' }, question: { zh: '请给出变截面起始高度。', en: 'Please provide the start depth for the tapered section.' }, unit: 'mm' },
        hEnd: { label: { zh: '终止高度', en: 'End depth' }, question: { zh: '请给出变截面终止高度。', en: 'Please provide the end depth for the tapered section.' }, unit: 'mm' },
        bStart: { label: { zh: '起始宽度', en: 'Start width' }, question: { zh: '请给出变截面起始宽度。', en: 'Please provide the start width for the tapered section.' }, unit: 'mm' },
        bEnd: { label: { zh: '终止宽度', en: 'End width' }, question: { zh: '请给出变截面终止宽度。', en: 'Please provide the end width for the tapered section.' }, unit: 'mm' },
        webOffset: { label: { zh: '腹板偏心', en: 'Web offset' }, question: { zh: '请给出腹板偏心距离。', en: 'Please provide the web offset distance.' }, unit: 'mm' },
        openingWidth: { label: { zh: '孔宽', en: 'Opening width' }, question: { zh: '请给出开孔宽度。', en: 'Please provide the opening width.' }, unit: 'mm' },
        openingHeight: { label: { zh: '孔高', en: 'Opening height' }, question: { zh: '请给出开孔高度。', en: 'Please provide the opening height.' }, unit: 'mm' },
        openingPosition: { label: { zh: '孔位', en: 'Opening position' }, question: { zh: '请给出开孔位置，若是比例可直接输入 0 到 1 之间的小数。', en: 'Please provide the opening position; if you prefer a ratio, use a decimal between 0 and 1.' }, unit: undefined },
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
        state[paramKey],
        geometryQuestion?.unit,
      );
    });
  },

  buildDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
    const message = parseString(state.message) ?? '';
    const proposals: SkillDefaultProposal[] = [];
    const profile = IRREGULAR_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? pickIrregularProfile(message, state);

    if (keys.includes('sectionType')) {
      const defaultType = containsAny(normalizeSectionText(message), ['开孔', 'opening'])
        ? 'section-with-opening'
        : containsAny(normalizeSectionText(message), ['箱'])
          ? 'tapered-box'
          : containsAny(normalizeSectionText(message), ['非对称', 'asymmetric', '偏心'])
            ? 'asymmetric-built-up'
            : 'tapered-i';
      proposals.push(buildProposal(locale, 'sectionType', defaultType, {
        zh: '不规则截面建议先从最容易补参的模板开始，再逐步细化轮廓。',
        en: 'Start from the easiest irregular template first, then refine the outline step by step.',
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

    if (keys.includes('memberRole')) {
      proposals.push(buildProposal(locale, 'memberRole', profile.defaultMemberRole, {
        zh: '默认采用该不规则截面的典型构件角色。',
        en: 'Use the profile’s typical member role as the default.',
      }));
    }

    if (keys.includes('materialFamily')) {
      proposals.push(buildProposal(locale, 'materialFamily', 'steel', {
        zh: '默认先按钢结构不规则截面处理。',
        en: 'Default to a steel irregular section baseline first.',
      }));
    }

    if (keys.includes('materialGrade')) {
      proposals.push(buildProposal(locale, 'materialGrade', 'Q355', {
        zh: '钢截面默认先按 Q355 作为材料起点。',
        en: 'Q355 is the usual baseline for steel sections.',
      }));
    }

    return proposals;
  },

  buildReportNarrative(input: SkillReportNarrativeInput): string {
    return buildIrregularNarrative(input);
  },

  buildModel(state: DraftState): Record<string, unknown> | undefined {
    return buildIrregularModel(state);
  },

  resolveStage(missingKeys: string[], state: DraftState): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report' {
    if (missingKeys.includes('sectionType') || missingKeys.includes('outlinePoints')) {
      return 'intent';
    }
    if (missingKeys.some((key) => ['h', 'b', 'tw', 'tf', 't', 'hStart', 'hEnd', 'bStart', 'bEnd', 'webOffset', 'openingWidth', 'openingHeight'].includes(key))) {
      return 'model';
    }
    if (!parseString(state.materialFamily) || !parseString(state.materialGrade)) {
      return 'model';
    }
    return 'analysis';
  },
};

export default handler;
