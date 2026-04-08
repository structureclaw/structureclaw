export const BUILTIN_VALIDATION_STRUCTURE_MODEL_SKILL_ID = 'validation-structure-model' as const;
export const BUILTIN_VALIDATION_STRUCTURE_MODEL_LEGACY_ALIASES = ['structure-json-validation'] as const;

export function resolveBuiltinValidationSkillCanonicalId(skillId: string): string {
  return BUILTIN_VALIDATION_STRUCTURE_MODEL_LEGACY_ALIASES.includes(
    skillId as typeof BUILTIN_VALIDATION_STRUCTURE_MODEL_LEGACY_ALIASES[number],
  )
    ? BUILTIN_VALIDATION_STRUCTURE_MODEL_SKILL_ID
    : skillId;
}
