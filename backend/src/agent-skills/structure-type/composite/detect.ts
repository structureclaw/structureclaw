import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import { matchConservativeStructuralRoute } from '../../../agent-runtime/structural-routing.js';
import type { SkillDetectionInput, StructuralTypeMatch } from '../../../agent-runtime/types.js';

export function detectCompositeStructuralType({ message, locale }: SkillDetectionInput): StructuralTypeMatch | null {
  const route = matchConservativeStructuralRoute(message);
  if (route?.skillId !== 'composite') {
    return null;
  }
  return buildStructuralTypeMatch('composite', 'frame', 'composite', route.supportLevel, locale, undefined, route.routingSource);
}
