/**
 * Validation runtime routing table
 * 验证运行时路由表
 *
 * Validation skill identity and metadata now come from `skill.yaml`.
 * This module keeps only the runtime action mappings used by the validation adapter.
 */

import type { ValidationExecutionAction } from './types.js';

export const VALIDATION_GET_ACTION_BY_PATH: Record<string, ValidationExecutionAction> = {
  '/validators': 'list_validators',
};

export const VALIDATION_POST_ACTION_BY_PATH: Record<string, ValidationExecutionAction> = {
  '/validate': 'validate',
};
