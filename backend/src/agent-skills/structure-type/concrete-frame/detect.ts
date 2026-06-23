import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import { matchConservativeStructuralRoute } from '../../../agent-runtime/structural-routing.js';
import type { SkillDetectionInput, StructuralTypeMatch } from '../../../agent-runtime/types.js';

export function detectConcreteFrameStructuralType({ message, locale }: SkillDetectionInput): StructuralTypeMatch | null {
  const text = message.toLowerCase();
  const route = matchConservativeStructuralRoute(message);
  if (route?.skillId !== 'concrete-frame') {
    return null;
  }
  if (
    (text.includes('frame') || text.includes('框架') || text.includes('混凝土框架') || text.includes('钢筋混凝土框架')) &&
    (text.includes('irregular') || text.includes('不规则') || text.includes('退台') || text.includes('缺跨'))
  ) {
    return buildStructuralTypeMatch('concrete-frame', 'frame', 'concrete-frame', 'unsupported', locale, {
      zh: '当前 concrete‑frame skill 只支持规则楼层和规则轴网框架。若结构存在退台、缺跨或明显不规则，请直接提供 JSON 或更具体的节点构件描述。',
      en: 'The current concrete‑frame skill only supports regular stories and regular grids. If the structure has setbacks, missing bays, or strong irregularities, please provide JSON or a more explicit node/member description.',
    }, route.routingSource);
  }
  return buildStructuralTypeMatch('concrete-frame', 'frame', 'concrete-frame', route.supportLevel, locale, undefined, route.routingSource);
}
