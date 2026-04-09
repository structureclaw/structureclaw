import type {
  DraftExtraction,
  DraftState,
  SkillDetectionInput,
  SkillDefaultProposal,
  SkillDraftContext,
  SkillHandler,
  InteractionQuestion,
  SkillMissingResult,
  StructuralTypeMatch,
  SkillReportNarrativeInput,
  LocalizedText,
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

type SectionType = 'i-beam' | 'h-beam' | 'rectangle' | 'box' | 'pipe' | 'channel';
interface SectionGeometry {
  h?: number;
  b?: number;
  tw?: number;
  tf?: number;
  r?: number;
  d?: number;
  t?: number;
}

const COMMON_MODEL_WARNING = 'The generated section model is a baseline skeleton and should be validated against project-specific rules.';

const COMMON_SECTION_PROFILES: SectionProfile[] = [
  {
    id: 'h-beam',
    aliases: ['h型钢', 'h-beam', 'h beam', 'h section', 'h-section', 'h型', 'h profile'],
    label: { zh: 'H型钢', en: 'H-beam' },
    description: { zh: '标准 H 形截面，适合梁、柱与刚架构件。', en: 'Standard H-shaped section for beams, columns, and frame members.' },
    defaultGeometry: { h: 450, b: 200, tw: 9, tf: 16, r: 16 },
    requiredKeys: ['h', 'b', 'tw', 'tf'],
    optionalKeys: ['r'],
    dimensionAliases: {
      h: ['h', 'height', 'depth', '高', '截面高', '截面深'],
      b: ['b', 'width', 'flange', '宽', '翼缘宽'],
      tw: ['tw', 'web', '腹板', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
      r: ['r', 'radius', '圆角'],
    },
    defaultMemberRole: 'beam',
  },
  {
    id: 'i-beam',
    aliases: ['i型钢', 'i-beam', 'i beam', '工字钢', 'i section'],
    label: { zh: '工字钢', en: 'I-beam' },
    description: { zh: '标准工字形截面，适合梁系与轻型框架。', en: 'Standard I-shaped section for beam systems and light frames.' },
    defaultGeometry: { h: 400, b: 200, tw: 8, tf: 13, r: 14 },
    requiredKeys: ['h', 'b', 'tw', 'tf'],
    optionalKeys: ['r'],
    dimensionAliases: {
      h: ['h', 'height', 'depth', '高', '截面高'],
      b: ['b', 'width', '翼缘宽', 'flange width'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
      r: ['r', 'radius', '圆角'],
    },
    defaultMemberRole: 'beam',
  },
  {
    id: 'box',
    aliases: ['box', 'box section', '箱形', '箱形截面', '箱梁', 'box beam'],
    label: { zh: '箱形截面', en: 'Box section' },
    description: { zh: '封闭薄壁截面，适合抗扭需求更高的构件。', en: 'Closed thin-walled section for members with higher torsional demand.' },
    defaultGeometry: { h: 400, b: 200, t: 12 },
    requiredKeys: ['h', 'b', 't'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'height', 'depth', '高'],
      b: ['b', 'width', '宽'],
      t: ['t', 'thickness', '壁厚'],
    },
    defaultMemberRole: 'beam',
  },
  {
    id: 'pipe',
    aliases: ['pipe', 'tube', '圆管', '钢管', 'circular tube'],
    label: { zh: '圆管截面', en: 'Pipe section' },
    description: { zh: '圆管或钢管截面，常用于支撑与空间杆件。', en: 'Circular tubular section commonly used for braces and lattice members.' },
    defaultGeometry: { d: 219, t: 8 },
    requiredKeys: ['d', 't'],
    optionalKeys: [],
    dimensionAliases: {
      d: ['d', 'diameter', '直径'],
      t: ['t', 'thickness', '壁厚'],
    },
    defaultMemberRole: 'column',
  },
  {
    id: 'channel',
    aliases: ['channel', '槽钢', 'u型钢', 'c型钢', 'u-section'],
    label: { zh: '槽钢截面', en: 'Channel section' },
    description: { zh: '开口型薄壁截面，适合次构件与轻型构造。', en: 'Open thin-walled section for secondary members and light construction.' },
    defaultGeometry: { h: 400, b: 100, tw: 8, tf: 12 },
    requiredKeys: ['h', 'b', 'tw', 'tf'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'height', 'depth', '高'],
      b: ['b', 'width', '宽'],
      tw: ['tw', 'web', '腹板厚'],
      tf: ['tf', 'flange thickness', '翼缘厚'],
    },
    defaultMemberRole: 'beam',
  },
  {
    id: 'rectangle',
    aliases: ['rectangle', 'rect', '矩形', '矩形截面'],
    label: { zh: '矩形截面', en: 'Rectangle section' },
    description: { zh: '实心矩形截面，常用于混凝土或简化构件表达。', en: 'Solid rectangular section commonly used for concrete or simplified member representation.' },
    defaultGeometry: { h: 400, b: 200 },
    requiredKeys: ['h', 'b'],
    optionalKeys: [],
    dimensionAliases: {
      h: ['h', 'height', 'depth', '高'],
      b: ['b', 'width', '宽'],
    },
    defaultMemberRole: 'column',
  },
];

function pickCommonProfile(message: string, state: DraftState | undefined): SectionProfile {
  const text = normalizeSectionText(message);
  const currentShape = parseString(state?.sectionType) as SectionType | undefined;
  if (currentShape) {
    const fromState = COMMON_SECTION_PROFILES.find((profile) => profile.id === currentShape);
    if (fromState) {
      return fromState;
    }
  }
  return pickSectionProfile(text, COMMON_SECTION_PROFILES) ?? COMMON_SECTION_PROFILES[0];
}

function inferCommonRole(text: string, profile: SectionProfile): 'beam' | 'column' | 'generic' {
  if (containsAny(text, ['柱', 'column', '支撑', 'brace'])) {
    return 'column';
  }
  if (containsAny(text, ['梁', 'beam', 'girder', '主梁', '次梁', '屋架'])) {
    return 'beam';
  }
  return profile.defaultMemberRole === 'column' ? 'column' : 'beam';
}

function normalizeRole(role: unknown, fallback: 'beam' | 'column' | 'generic'): 'beam' | 'column' | 'generic' {
  const text = parseString(role)?.toLowerCase();
  if (!text) {
    return fallback;
  }
  if (text.includes('column') || text.includes('柱')) {
    return 'column';
  }
  if (text.includes('beam') || text.includes('梁') || text.includes('girder')) {
    return 'beam';
  }
  return fallback;
}

function extractSectionTypeFromValues(values: Record<string, unknown>, message: string, state?: DraftState): SectionType {
  const rawShape = parseString(values.sectionType) ?? parseString(values.shape) ?? parseString(values.profile) ?? parseString(values.section);
  if (rawShape) {
    const normalized = normalizeSectionText(rawShape);
    const matched = COMMON_SECTION_PROFILES.find((profile) => profile.aliases.some((alias) => normalized.includes(normalizeSectionText(alias))));
    if (matched) {
      return matched.id as SectionType;
    }
  }

  const profile = pickCommonProfile(message, state);
  return profile.id as SectionType;
}

function parseBeamLikeNotation(message: string): Partial<SectionGeometry> {
  const normalized = normalizeSectionText(message);
  const match = normalized.match(/(?:h型钢|h-beam|h beam|工字钢|i-beam|i beam|h section|i section)\s*(\d{2,4})\s*x\s*(\d{2,4})\s*x\s*(\d{1,3})\s*x\s*(\d{1,3})/i);
  if (!match) {
    return {};
  }
  return {
    h: Number.parseFloat(match[1]),
    b: Number.parseFloat(match[2]),
    tw: Number.parseFloat(match[3]),
    tf: Number.parseFloat(match[4]),
  };
}

function parseBoxNotation(message: string): Partial<SectionGeometry> {
  const normalized = normalizeSectionText(message);
  const match = normalized.match(/(?:box|box section|箱形|箱梁)\s*(\d{2,4})\s*x\s*(\d{2,4})\s*x\s*(\d{1,3})/i);
  if (!match) {
    return {};
  }
  return {
    h: Number.parseFloat(match[1]),
    b: Number.parseFloat(match[2]),
    t: Number.parseFloat(match[3]),
  };
}

function parsePipeNotation(message: string): Partial<SectionGeometry> {
  const normalized = normalizeSectionText(message);
  const match = normalized.match(/(?:pipe|tube|圆管|钢管)\s*(\d{2,4})\s*x\s*(\d{1,3})/i);
  if (!match) {
    return {};
  }
  return {
    d: Number.parseFloat(match[1]),
    t: Number.parseFloat(match[2]),
  };
}

function parseSectionGeometry(message: string, profile: SectionProfile, values: Record<string, unknown>): SectionGeometry {
  const text = normalizeSectionText(message);
  const namedValues = extractNamedNumbers(text, profile.dimensionAliases);
  const geometry: SectionGeometry = {};

  for (const key of Object.keys(profile.defaultGeometry)) {
    const numericValue = parsePositiveNumber(values[key]) ?? namedValues[key];
    if (numericValue !== undefined) {
      geometry[key as keyof SectionGeometry] = numericValue;
    }
  }

  const compactPatch = profile.id === 'pipe'
    ? parsePipeNotation(text)
    : profile.id === 'box'
      ? parseBoxNotation(text)
      : parseBeamLikeNotation(text);

  return {
    ...profile.defaultGeometry,
    ...compactPatch,
    ...geometry,
  };
}

function buildCommonMaterialGrade(values: Record<string, unknown>, message: string): string {
  return parseString(values.materialGrade)
    ?? parseString(values.grade)
    ?? (containsAny(normalizeSectionText(message), ['q235']) ? 'Q235' : 'Q355');
}

function buildCommonModel(state: DraftState): Record<string, unknown> {
  const profile = pickCommonProfile(String(state.message ?? ''), state);
  const geometry = (state.geo as SectionGeometry | undefined) ?? profile.defaultGeometry;
  return buildSectionModel({
    skillId: 'section-common',
    family: 'common',
    title: { zh: '通用截面模型', en: 'Common section model' },
    sectionType: profile.id,
    memberRole: normalizeRole(state.memberRole, profile.defaultMemberRole === 'column' ? 'column' : 'beam'),
    materialGrade: parseString(state.materialGrade) ?? 'Q355',
    materialName: { zh: 'Q355 钢材', en: 'Q355 steel' },
    geometry: geometry as Record<string, unknown>,
    spanLengthM: parsePositiveNumber(state.spanLengthM ?? state.lengthM) ?? 6,
    warnings: [COMMON_MODEL_WARNING],
    extras: {
      profileLabel: profile.label,
      profileDescription: profile.description,
    },
  });
}

function buildCommonNarrative(input: SkillReportNarrativeInput): string {
  const userIntent = parseString(input.message) ?? 'section request';
  if (input.locale === 'zh') {
    return [
      '## 通用截面说明',
      `- 当前用户意图：${userIntent}。`,
      '- 已给出可直接进入补参或初步校核的模型骨架。',
      '- 若后续需要更严格的规范校核，建议补充构件角色、设计荷载与控制工况。',
    ].join('\n');
  }

  return [
    '## Common Section Notes',
    `- Current user intent: ${userIntent}.`,
    '- A model skeleton is ready for follow-up parameter completion or a first-pass check.',
    '- For stricter validation, add member role, design loads, and governing load cases.',
  ].join('\n');
}

export class SectionCommonHandler implements SkillHandler {
  detectStructuralType(input: SkillDetectionInput): StructuralTypeMatch | null {
    const { message, locale = 'zh', currentState } = input;
    const text = normalizeSectionText(message);

    if (containsAny(text, ['bridge', 'bridge girder', '桥梁', '桥箱梁', '钢箱梁'])) {
      return null;
    }
    if (containsAny(text, ['irregular', '不规则', '变截面', '异形', 'custom', 'tapered', 'haunch'])) {
      return null;
    }
    if (!containsAny(text, ['截面', 'section', 'profile', '工字钢', 'h型钢', 'i-beam', 'box', 'pipe', '槽钢', '矩形', '梁', '柱', '框架'])) {
      return currentState?.skillId === 'section-common'
        ? buildStructuralTypeMatch(currentState.structuralTypeKey ?? 'frame', currentState.inferredType ?? 'frame', 'section-common', currentState.supportLevel ?? 'fallback', locale, {
            zh: '继续沿用通用截面 skill 处理当前草稿。',
            en: 'Continue using the common section skill for the current draft.',
          })
        : null;
    }

    const key = containsAny(text, ['柱', 'column']) ? 'frame' : containsAny(text, ['梁', 'beam', 'girder', '工字钢', 'h型钢']) ? 'beam' : 'frame';
    const mappedType = key === 'beam' ? 'beam' : 'frame';
    return buildStructuralTypeMatch(key, mappedType, 'section-common', 'supported', locale, {
      zh: '通用截面 skill 已接住当前请求。',
      en: 'The common section skill has captured the current request.',
    });
  }

  parseProvidedValues(values: Record<string, unknown>): DraftExtraction {
    const message = parseString(values.message) ?? '';
    const normalizedMessage = normalizeSectionText(message);
    const sectionType = extractSectionTypeFromValues(values, message);
    const profile = COMMON_SECTION_PROFILES.find((entry) => entry.id === sectionType) ?? pickCommonProfile(message, undefined);
    const geometry = parseSectionGeometry(message, profile, values);
    const role = normalizeRole(values.memberRole, inferCommonRole(normalizedMessage, profile));
    const spanLengthM = parsePositiveNumber(values.spanLengthM ?? values.lengthM) ?? 6;

    return {
      skillId: 'section-common',
      inferredType: role === 'column' ? 'frame' : 'beam',
      structuralTypeKey: role === 'column' ? 'frame' : 'beam',
      sectionType,
      memberRole: role,
      materialGrade: buildCommonMaterialGrade(values, message),
      spanLengthM,
      geo: geometry,
      h: geometry.h,
      b: geometry.b,
      tw: geometry.tw,
      tf: geometry.tf,
      r: geometry.r,
      d: geometry.d,
      t: geometry.t,
      outlinePoints: parsePointList(values.outlinePoints ?? values.points ?? values.vertices),
    };
  }

  extractDraft(ctx: SkillDraftContext): DraftExtraction {
    const message = ctx.message ?? '';
    const profile = pickCommonProfile(message, ctx.currentState);
    const patch = this.parseProvidedValues({
      ...ctx.llmDraftPatch,
      message,
      sectionType: ctx.llmDraftPatch?.sectionType ?? ctx.currentState?.sectionType ?? profile.id,
      memberRole: ctx.currentState?.memberRole ?? profile.defaultMemberRole,
      materialGrade: ctx.currentState?.materialGrade,
      spanLengthM: ctx.llmDraftPatch?.spanLengthM ?? ctx.currentState?.spanLengthM,
      lengthM: ctx.currentState?.lengthM,
      outlinePoints: ctx.llmDraftPatch?.outlinePoints ?? ctx.currentState?.outlinePoints,
    });

    return {
      ...patch,
      skillState: {
        source: 'section-common',
        profileId: profile.id,
      },
    };
  }

  mergeState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
    return mergeSectionState(existing, patch, {
      inferredType: 'frame',
      skillId: 'section-common',
      structuralTypeKey: 'frame',
      supportLevel: 'supported',
    });
  }

  computeMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult {
    const critical: string[] = [];
    const optional: string[] = [];
    const profile = COMMON_SECTION_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? COMMON_SECTION_PROFILES[0];

    if (!parseString(state.sectionType)) {
      critical.push('sectionType');
    }

    for (const key of profile.requiredKeys) {
      if (parsePositiveNumber(state[key]) === undefined) {
        critical.push(key);
      }
    }

    for (const key of profile.optionalKeys) {
      if (parsePositiveNumber(state[key]) === undefined) {
        optional.push(key);
      }
    }

    if (!parseString(state.materialGrade)) {
      optional.push('materialGrade');
    }
    if (!parseString(state.memberRole)) {
      optional.push('memberRole');
    }
    if (phase === 'execution' && parsePositiveNumber(state.spanLengthM ?? state.lengthM) === undefined) {
      critical.push('spanLengthM');
    }

    return {
      critical: Array.from(new Set(critical)),
      optional: Array.from(new Set(optional)),
    };
  }

  mapLabels(keys: string[], locale: AppLocale): string[] {
    const labels: Record<string, string> = {
      sectionType: localize(locale, '截面类型', 'Section type'),
      memberRole: localize(locale, '构件角色', 'Member role'),
      materialGrade: localize(locale, '钢材牌号', 'Material grade'),
      spanLengthM: localize(locale, '构件长度 (m)', 'Member length (m)'),
      h: localize(locale, '截面高度 h', 'Section depth h'),
      b: localize(locale, '截面宽度 b', 'Section width b'),
      tw: localize(locale, '腹板厚度 tw', 'Web thickness tw'),
      tf: localize(locale, '翼缘厚度 tf', 'Flange thickness tf'),
      r: localize(locale, '圆角半径 r', 'Radius r'),
      d: localize(locale, '外径 d', 'Outside diameter d'),
      t: localize(locale, '壁厚 t', 'Wall thickness t'),
      outlinePoints: localize(locale, '轮廓点', 'Outline points'),
    };
    return keys.map((key) => labels[key] ?? key);
  }

  buildQuestions(keys: string[], criticalMissing: string[], state: DraftState, locale: AppLocale): InteractionQuestion[] {
    const profile = COMMON_SECTION_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? pickCommonProfile('', state);
    return keys.map((paramKey) => {
      if (paramKey === 'sectionType') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '截面类型', en: 'Section type' },
          {
            zh: '请确认你要设计的标准截面类型，例如工字钢、H 型钢、箱形、圆管或槽钢；如果目标是梁或柱，也请一起说明。',
            en: 'Please confirm the standard section type, such as I-beam, H-beam, box section, pipe, or channel; also mention whether it is for a beam or column.',
          },
          true,
          criticalMissing.includes(paramKey),
          profile.label,
        );
      }

      const geometryQuestionMap: Record<string, { label: LocalizedText; question: LocalizedText; unit: string }> = {
        h: {
          label: { zh: '截面高度 h', en: 'Section depth h' },
          question: { zh: '请给出截面高度 h。若已知标准型号，也可以直接输入如 H400x200x8x13。', en: 'Please provide the section depth h. If you know the standard designation, you can also enter a compact notation such as H400x200x8x13.' },
          unit: 'mm',
        },
        b: {
          label: { zh: '截面宽度 b', en: 'Section width b' },
          question: { zh: '请给出截面宽度 b。若是矩形或箱形截面，请说明外轮廓宽度。', en: 'Please provide the section width b. For rectangular or box sections, state the outer width.' },
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
        r: {
          label: { zh: '圆角半径 r', en: 'Radius r' },
          question: { zh: '如需更接近标准型钢，请补充圆角半径 r；不填时可先用默认值。', en: 'If you want a closer standard-profile approximation, provide the radius r; otherwise a default value can be used.' },
          unit: 'mm',
        },
        d: {
          label: { zh: '外径 d', en: 'Outside diameter d' },
          question: { zh: '请给出圆管外径 d。', en: 'Please provide the outside diameter d.' },
          unit: 'mm',
        },
        t: {
          label: { zh: '壁厚 t', en: 'Wall thickness t' },
          question: { zh: '请给出壁厚 t。', en: 'Please provide the wall thickness t.' },
          unit: 'mm',
        },
      };

      if (paramKey === 'memberRole') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '构件角色', en: 'Member role' },
          {
            zh: '请说明该截面是用于梁、柱还是支撑，这会影响默认截面和约束建议。',
            en: 'Please clarify whether this section is for a beam, column, or brace, because that affects the defaults and support assumptions.',
          },
          false,
          false,
          state.memberRole ?? profile.defaultMemberRole,
        );
      }

      if (paramKey === 'materialGrade') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '钢材牌号', en: 'Material grade' },
          {
            zh: '请确认钢材牌号；若未指定，默认可先按 Q355 处理。',
            en: 'Please confirm the material grade. If unspecified, Q355 will be used as the default baseline.',
          },
          false,
          false,
          state.materialGrade ?? 'Q355',
        );
      }

      if (paramKey === 'spanLengthM') {
        return buildQuestion(
          locale,
          paramKey,
          { zh: '构件长度', en: 'Member length' },
          {
            zh: '如果你希望直接生成一个可检查的构件骨架，请提供构件长度（m）。',
            en: 'If you want a directly checkable member skeleton, please provide the member length in meters.',
          },
          criticalMissing.includes(paramKey),
          criticalMissing.includes(paramKey),
          state.spanLengthM ?? 6,
          'm',
        );
      }

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
  }

  buildDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
    const profile = COMMON_SECTION_PROFILES.find((entry) => entry.id === parseString(state.sectionType)) ?? pickCommonProfile('', state);
    const proposals: SkillDefaultProposal[] = [];

    if (keys.includes('sectionType')) {
      proposals.push(buildProposal(locale, 'sectionType', profile.id, {
        zh: `默认优先使用 ${profile.label.zh}，它最适合作为常规截面起点。`,
        en: `Default to ${profile.label.en}, which is the most practical starting point for a common section.`,
      }));
    }

    if (keys.includes('memberRole')) {
      proposals.push(buildProposal(locale, 'memberRole', profile.defaultMemberRole, {
        zh: '默认按该截面的典型构件角色处理。',
        en: 'Use the profile’s typical member role as the default.',
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

    if (keys.includes('materialGrade')) {
      proposals.push(buildProposal(locale, 'materialGrade', 'Q355', {
        zh: '常规钢截面默认先按 Q355 作为起点。',
        en: 'Q355 is the usual baseline default for common steel sections.',
      }));
    }

    return proposals;
  }

  buildReportNarrative(input: SkillReportNarrativeInput): string {
    return buildCommonNarrative(input);
  }

  buildModel(state: DraftState): Record<string, unknown> | undefined {
    return buildCommonModel(state);
  }

  resolveStage(missingKeys: string[], state: DraftState): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report' {
    if (missingKeys.includes('sectionType')) {
      return 'intent';
    }
    if (missingKeys.some((key) => ['h', 'b', 'tw', 'tf', 'r', 'd', 't'].includes(key))) {
      return 'model';
    }
    if (!parseString(state.memberRole) || !parseString(state.materialGrade)) {
      return 'model';
    }
    return 'analysis';
  }
}

export const handler = new SectionCommonHandler();
export default handler;