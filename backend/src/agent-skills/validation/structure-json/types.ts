import type { ValidationResult, ValidationIssue, ValidationOptions } from '../types.js';

/**
 * Structure JSON validation input
 * 结构 JSON 验证输入
 */
export interface StructureJsonValidationInput {
  /** JSON string or parsed object / JSON 字符串或已解析对象 */
  jsonData: string | unknown;
  /** Validation options / 验证选项 */
  options?: ValidationOptions;
}

/**
 * Structure JSON validation output
 * 结构 JSON 验证输出
 */
export interface StructureJsonValidationOutput {
  /** Validation result / 验证结果 */
  result: ValidationResult;
  /** Processing time in milliseconds / 处理时间（毫秒） */
  processingTimeMs: number;
}

/**
 * Python runtime validation request
 * Python 运行时验证请求
 */
export interface ValidationRuntimeRequest {
  json_data: string;
  schema_version: string;
  options: {
    stop_on_first_error: boolean;
    include_warnings: boolean;
    include_info: boolean;
    semantic_validation: boolean;
  };
}

/**
 * Python runtime validation response
 * Python 运行时验证响应
 */
export interface ValidationRuntimeResponse {
  valid: boolean;
  summary: {
    error_count: number;
    warning_count: number;
    info_count: number;
  };
  issues: Array<{
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    path?: string;
    suggestion?: string;
  }>;
  validated_model?: unknown;
  error?: string;
}

export type { ValidationResult, ValidationIssue, ValidationOptions };
