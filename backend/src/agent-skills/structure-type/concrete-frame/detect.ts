import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import type { SkillDetectionInput, StructuralTypeMatch } from '../../../agent-runtime/types.js';

export function detectConcreteFrameStructuralType({ message, locale, currentState }: SkillDetectionInput): StructuralTypeMatch | null {
  const text = message.toLowerCase();
  if (
    (text.includes('frame') || text.includes('框架') || text.includes('混凝土框架') || text.includes('钢筋混凝土框架')) &&
    (text.includes('irregular') || text.includes('不规则') || text.includes('退台') || text.includes('缺跨'))
  ) {
    return buildStructuralTypeMatch('concrete-frame', 'unknown', 'concrete-frame', 'unsupported', locale, {
      zh: '当前 concrete‑frame skill 只支持规则楼层和规则轴网框架。若结构存在退台、缺跨或明显不规则，请直接提供 JSON 或更具体的节点构件描述。',
      en: 'The current concrete‑frame skill only supports regular stories and regular grids. If the structure has setbacks, missing bays, or strong irregularities, please provide JSON or a more explicit node/member description.',
    });
  }
  if (text.includes('concrete frame') || text.includes('混凝土框架') || text.includes('钢筋混凝土框架') || text.includes('rc frame')) {
    return buildStructuralTypeMatch('concrete-frame', 'frame', 'concrete-frame', 'supported', locale);
  }
  if (text.includes('frame') || text.includes('框架')) {
    const isConcrete = text.includes('concrete') || text.includes('混凝土') || text.includes('钢筋砼') || text.includes('rc');
    const isSteel = text.includes('steel') || text.includes('钢');
    if (isConcrete && !isSteel) {
      return buildStructuralTypeMatch('concrete-frame', 'frame', 'concrete-frame', 'supported', locale);
    }
  }
  // Common Chinese structural descriptions that imply a concrete frame structure:
  const isConcrete = text.includes('混凝土') || text.includes('钢筋砼') || text.includes('rc');
  const hasFrameContext = text.includes('柱网') ||
    text.includes('办公楼') ||
    text.includes('住宅楼') ||
    text.includes('商住') ||
    text.includes('教学楼') ||
    text.includes('医院') ||
    /\d+层.*\d+跨/.test(text) ||
    /\d+跨.*\d+层/.test(text) ||
    (text.includes('层') && text.includes('跨'));
  if (isConcrete && hasFrameContext) {
    return buildStructuralTypeMatch('concrete-frame', 'frame', 'concrete-frame', 'supported', locale);
  }
  // Concrete grade detection
  const concreteGradePattern = /\b(C[2-8][0-9]|C20|C25|C30|C35|C40|C45|C50|C55|C60|C65|C70|C75|C80)\b/i;
  if (concreteGradePattern.test(text) && hasFrameContext) {
    return buildStructuralTypeMatch('concrete-frame', 'frame', 'concrete-frame', 'supported', locale);
  }
  if (currentState?.structuralTypeKey === 'concrete-frame' && currentState.supportLevel !== 'unsupported') {
    return buildStructuralTypeMatch('concrete-frame', 'frame', 'concrete-frame', 'supported', locale);
  }
  return null;
}