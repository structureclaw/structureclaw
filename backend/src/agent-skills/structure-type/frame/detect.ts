import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import type { SkillDetectionInput, StructuralTypeMatch } from '../../../agent-runtime/types.js';

export function detectFrameStructuralType({ message, locale, currentState }: SkillDetectionInput): StructuralTypeMatch | null {
  const text = message.toLowerCase();
  if (
    (text.includes('frame') || text.includes('框架') || text.includes('钢框架'))
    && (text.includes('irregular') || text.includes('不规则') || text.includes('退台') || text.includes('缺跨'))
  ) {
    return buildStructuralTypeMatch('frame', 'unknown', 'frame', 'unsupported', locale, {
      zh: '当前 frame skill 只支持规则楼层和规则轴网框架。若结构存在退台、缺跨或明显不规则，请直接提供 JSON 或更具体的节点构件描述。',
      en: 'The current frame skill only supports regular stories and regular grids. If the structure has setbacks, missing bays, or strong irregularities, please provide JSON or a more explicit node/member description.',
    });
  }
  if (text.includes('steel frame') || text.includes('钢框架')) {
    return buildStructuralTypeMatch('steel-frame', 'frame', 'frame', 'supported', locale);
  }
  if (text.includes('frame') || text.includes('框架')) {
    return buildStructuralTypeMatch('frame', 'frame', 'frame', 'supported', locale);
  }
  if (currentState?.inferredType === 'frame' && currentState.supportLevel !== 'unsupported') {
    const key = (currentState.structuralTypeKey === 'steel-frame' ? 'steel-frame' : 'frame') as StructuralTypeMatch['key'];
    return buildStructuralTypeMatch(key, 'frame', 'frame', 'supported', locale);
  }
  return null;
}
