/**
 * Validation skill shared types
 * 验证技能公共类型定义
 */

/**
 * Validation severity levels
 * 验证结果严重级别
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Single validation issue
 * 单个验证问题
 */
export interface ValidationIssue {
  /** Severity level / 严重级别 */
  severity: ValidationSeverity;
  /** Error code / 错误代码，如 "SCHEMA_MISSING_FIELD" */
  code: string;
  /** Human-readable message / 可读的错误描述 */
  message: string;
  /** JSON path to the issue / JSON 路径，如 "nodes[0].x" */
  path?: string;
  /** Suggested fix / 修复建议 */
  suggestion?: string;
}

/**
 * Validation summary statistics
 * 验证结果统计
 */
export interface ValidationSummary {
  /** Number of errors / 错误数量 */
  error_count: number;
  /** Number of warnings / 警告数量 */
  warning_count: number;
  /** Number of info messages / 信息数量 */
  info_count: number;
}

/**
 * Complete validation result
 * 完整验证结果
 */
export interface ValidationResult {
  /** Overall validity / 整体是否通过 */
  valid: boolean;
  /** Summary statistics / 统计摘要 */
  summary: ValidationSummary;
  /** List of issues / 问题列表 */
  issues: ValidationIssue[];
  /** Validated and cleaned model / 验证通过的模型（已清洗/补全） */
  validated_model?: unknown;
}

/**
 * Validation skill manifest
 * 验证技能清单
 */
export interface ValidationSkillManifest {
  id: string;
  domain: 'validation';
  name: {
    zh: string;
    en: string;
  };
  description: {
    zh: string;
    en: string;
  };
  triggers: string[];
  stages: ['validation'];
  capabilities: string[];
  priority: number;
  runtimeRelativePath: string;
  /** Supported schema versions / 支持的 schema 版本 */
  schemaVersions?: string[];
  /** Default schema version / 默认 schema 版本 */
  defaultSchemaVersion?: string;
}

/**
 * Validation execution input
 * 验证执行输入
 */
export interface ValidationExecutionInput {
  action: 'validate';
  input: {
    jsonData: string | unknown;
    options?: ValidationOptions;
  };
}

/**
 * Validation options
 * 验证选项
 */
export interface ValidationOptions {
  /** Schema version to validate against / 验证的 schema 版本 */
  schemaVersion?: '1.0.0' | '2.0.0';
  /** Stop on first error / 遇到第一个错误时停止 */
  stopOnFirstError?: boolean;
  /** Include warnings / 包含警告级别 */
  includeWarnings?: boolean;
  /** Include info messages / 包含信息级别 */
  includeInfo?: boolean;
  /** Perform semantic validation / 执行语义验证 */
  semanticValidation?: boolean;
}

/**
 * Validation execution action types
 * 验证执行动作类型
 */
export type ValidationExecutionAction = 'validate' | 'list_validators';
