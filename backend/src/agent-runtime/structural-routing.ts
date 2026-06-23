import type { InferredModelType, RoutingSource, StructuralTypeKey, StructuralTypeSupportLevel } from './types.js';

type SwitchStrength = 'strong' | 'weak';

export interface ConservativeStructuralRoute {
  key: StructuralTypeKey;
  mappedType: InferredModelType;
  skillId: string;
  supportLevel: StructuralTypeSupportLevel;
  routingSource: RoutingSource;
  switchStrength: SwitchStrength;
}

const TEXT_SEPARATORS = [
  '\r', '\n', '\t',
  ' ', ',', '.', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '/', '\\',
  '，', '。', '；', '：', '！', '？', '（', '）', '【', '】', '、',
];
const TEXT_SEPARATOR_PATTERN = /[\r\n\t ,.;:!?()[\]{}/\\，。；：！？（）【】、]+/g;
const CONCRETE_GRADE_PATTERN = /\bc(?:20|25|30|35|40|45|50|55|60|65|70|75|80)\b/i;

function normalizeForWords(message: string): string {
  return ` ${message.toLowerCase().replace(TEXT_SEPARATOR_PATTERN, ' ').trim()} `;
}

function hasWord(normalizedText: string, word: string): boolean {
  return normalizedText.includes(` ${word} `);
}

function hasRawPhrase(rawText: string, phrases: string[]): boolean {
  return phrases.some((phrase) => rawText.includes(phrase));
}

function hasEnglishPhrase(normalizedText: string, rawText: string, phrases: string[]): boolean {
  return phrases.some((phrase) => normalizedText.includes(` ${phrase} `) || rawText.includes(phrase));
}

function isStandaloneChineseToken(message: string, token: string): boolean {
  if (message.trim() === token) {
    return true;
  }
  let start = 0;
  while (start < message.length) {
    const index = message.indexOf(token, start);
    if (index < 0) {
      return false;
    }
    const before = index === 0 ? ' ' : message[index - 1];
    const afterIndex = index + token.length;
    const after = afterIndex >= message.length ? ' ' : message[afterIndex];
    if (TEXT_SEPARATORS.includes(before) && TEXT_SEPARATORS.includes(after)) {
      return true;
    }
    start = index + token.length;
  }
  return false;
}

function route(
  key: StructuralTypeKey,
  mappedType: InferredModelType,
  skillId: string,
  supportLevel: StructuralTypeSupportLevel = 'supported',
  switchStrength: SwitchStrength = 'strong',
): ConservativeStructuralRoute {
  return {
    key,
    mappedType,
    skillId,
    supportLevel,
    routingSource: 'explicit-keyword',
    switchStrength,
  };
}

function isBeamLoadContext(rawText: string, normalizedText: string): boolean {
  return rawText.includes('梁上')
    || normalizedText.includes(' beam load ')
    || normalizedText.includes(' load on the beam ');
}

function isColumnGridContext(rawText: string, normalizedText: string): boolean {
  return rawText.includes('柱网')
    || rawText.includes('柱距')
    || normalizedText.includes(' column grid ');
}

function hasConcreteCue(rawText: string, normalizedText: string): boolean {
  return rawText.includes('concrete')
    || rawText.includes('混凝土')
    || rawText.includes('钢筋砼')
    || rawText.includes('砼')
    || CONCRETE_GRADE_PATTERN.test(rawText)
    || hasWord(normalizedText, 'rc');
}

function hasConcreteFrameContext(rawText: string): boolean {
  return rawText.includes('柱网')
    || rawText.includes('办公楼')
    || rawText.includes('住宅楼')
    || rawText.includes('商住')
    || rawText.includes('教学楼')
    || rawText.includes('医院')
    || /\d+层.*\d+跨/u.test(rawText)
    || /\d+跨.*\d+层/u.test(rawText)
    || (rawText.includes('层') && rawText.includes('跨'));
}

export function matchConservativeStructuralRoute(message: string): ConservativeStructuralRoute | null {
  const rawText = message.toLowerCase();
  const normalizedText = normalizeForWords(message);

  if (
    hasEnglishPhrase(normalizedText, rawText, ['reinforced concrete frame', 'reinforced-concrete-frame', 'concrete frame', 'concrete-frame', 'rc frame', 'rc-frame'])
    || hasRawPhrase(rawText, ['钢筋混凝土框架', '钢筋砼框架', '混凝土框架', '砼框架', 'rc框架'])
  ) {
    return route('concrete-frame', 'frame', 'concrete-frame');
  }

  if (hasConcreteCue(rawText, normalizedText) && hasConcreteFrameContext(rawText)) {
    return route('concrete-frame', 'frame', 'concrete-frame');
  }

  if (
    hasEnglishPhrase(normalizedText, rawText, ['steel frame', 'steel-frame'])
    || hasRawPhrase(rawText, ['钢框架', '钢结构框架'])
  ) {
    return route('steel-frame', 'frame', 'frame');
  }

  if (
    hasEnglishPhrase(normalizedText, rawText, ['portal frame', 'portal-frame'])
    || hasRawPhrase(rawText, ['门式刚架'])
  ) {
    return route('portal-frame', 'portal-frame', 'portal-frame');
  }

  if (hasWord(normalizedText, 'portal') || hasRawPhrase(rawText, ['门架'])) {
    return route('portal', 'portal-frame', 'portal-frame', 'fallback');
  }

  if (
    hasWord(normalizedText, 'truss')
    || hasWord(normalizedText, 'trusses')
    || hasRawPhrase(rawText, ['桁架', '屋架'])
  ) {
    return route('truss', 'truss', 'truss');
  }

  if (
    hasEnglishPhrase(normalizedText, rawText, ['double span beam', 'double-span beam', 'double-span-beam', 'two span beam', 'two-span beam', 'continuous beam'])
    || hasRawPhrase(rawText, ['双跨梁', '双跨连续梁', '连续梁', '不等跨连续梁'])
  ) {
    return route('double-span-beam', 'double-span-beam', 'double-span-beam');
  }

  if (
    hasWord(normalizedText, 'girder')
    || hasRawPhrase(rawText, ['主梁', '大梁'])
  ) {
    return route('girder', 'beam', 'beam', 'fallback');
  }

  if (!isBeamLoadContext(rawText, normalizedText)) {
    if (
      hasWord(normalizedText, 'beam')
      || hasRawPhrase(rawText, ['简支梁', '悬臂梁', '单跨梁', '钢梁', '混凝土梁', '梁结构', '梁跨度', '梁长'])
    ) {
      return route('beam', 'beam', 'beam');
    }
    if (isStandaloneChineseToken(message, '梁')) {
      return route('beam', 'beam', 'beam', 'supported', 'weak');
    }
  }

  if (!isColumnGridContext(rawText, normalizedText)) {
    if (
      hasRawPhrase(rawText, ['独立柱', '单根柱', '柱构件', '混凝土柱', '钢柱', '柱子'])
    ) {
      return route('column', 'column', 'column');
    }
    if (hasWord(normalizedText, 'column') || isStandaloneChineseToken(message, '柱')) {
      return route('column', 'column', 'column', 'supported', 'weak');
    }
  }

  if (hasWord(normalizedText, 'frame') || hasRawPhrase(rawText, ['框架'])) {
    return route('frame', 'frame', 'frame');
  }

  return null;
}

export function isExplicitStructuralSwitch(message: string): boolean {
  const matched = matchConservativeStructuralRoute(message);
  if (!matched) {
    return false;
  }
  if (matched.switchStrength === 'strong') {
    return true;
  }

  const rawText = message.toLowerCase();
  const normalizedText = normalizeForWords(message);
  return hasRawPhrase(rawText, ['改成', '改为', '换成', '变成', '切换为', '转换为', '重新建模为'])
    || hasEnglishPhrase(normalizedText, rawText, ['change to', 'switch to', 'convert to', 'model as', 'use as']);
}
