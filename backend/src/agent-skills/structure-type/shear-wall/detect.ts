import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import { matchConservativeStructuralRoute } from '../../../agent-runtime/structural-routing.js';
import type { SkillDetectionInput, StructuralTypeMatch } from '../../../agent-runtime/types.js';

export function detectShearWallStructuralType({ message, locale }: SkillDetectionInput): StructuralTypeMatch | null {
  const route = matchConservativeStructuralRoute(message);
  if (route?.skillId !== 'shear-wall') {
    return null;
  }
  return buildStructuralTypeMatch('shear-wall', 'frame', 'shear-wall', route.supportLevel, locale, undefined, route.routingSource);
}
