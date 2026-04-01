/**
 * Validation Skills Module Entry Point
 * 验证技能模块入口
 *
 * Exports validation-related types, functions, and registries.
 */

// Export types
export type {
  ValidationSeverity,
  ValidationIssue,
  ValidationSummary,
  ValidationResult,
  ValidationSkillManifest,
  ValidationExecutionInput,
  ValidationExecutionAction,
  ValidationOptions,
} from './types.js';

// Export registry functions
export {
  BUILTIN_VALIDATION_SKILLS,
  VALIDATION_SKILL_BY_ID,
  VALIDATION_GET_ACTION_BY_PATH,
  VALIDATION_POST_ACTION_BY_PATH,
  listBuiltinValidationSkills,
  getBuiltinValidationSkill,
  hasValidationSkill,
  findValidationSkillsByTrigger,
  getValidationSkillCapabilities,
} from './registry.js';

// Export structure-json specific types
export type {
  StructureJsonValidationInput,
  StructureJsonValidationOutput,
  ValidationRuntimeRequest,
  ValidationRuntimeResponse,
} from './structure-json/types.js';
