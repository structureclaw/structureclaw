/**
 * Validation Skills Module Entry Point
 * 验证技能模块入口
 *
 * Exports validation runtime contracts and types.
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

// Export runtime routing tables
export {
  VALIDATION_GET_ACTION_BY_PATH,
  VALIDATION_POST_ACTION_BY_PATH,
} from './registry.js';

// Export structure-json specific types
export type {
  StructureJsonValidationInput,
  StructureJsonValidationOutput,
  ValidationRuntimeRequest,
  ValidationRuntimeResponse,
} from './structure-json/types.js';
