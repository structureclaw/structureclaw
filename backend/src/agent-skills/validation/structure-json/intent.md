---
id: structure-json-validation
zhName: 结构 JSON 验证
enName: Structure JSON Validation
zhDescription: 验证结构 JSON 的语法、schema、语义正确性，检查必填字段缺失。
enDescription: Validate structural JSON for syntax, schema compliance, semantic correctness, and missing required fields.
triggers: ["validate", "验证", "json check", "结构验证", "schema validation", "validate json", "检查 json"]
stages: ["validation"]
capabilities: ["syntax-check", "schema-validation", "semantic-validation", "missing-field-detection"]
priority: 100
autoLoadByDefault: true
runtimeRelativePath: runtime.py
schemaVersions: ["2.0.0", "1.0.0"]
defaultSchemaVersion: "2.0.0"
---
# Intent / 意图

## Purpose / 目的
- `zh`: 在下游执行前验证结构 JSON 的完整性和正确性，确保数据质量并提前发现潜在问题。
- `en`: Validate structural JSON integrity and correctness before downstream execution to ensure data quality and catch potential issues early.

## Validation Scope / 验证范围

### 1. Syntax Validation / 语法验证
- JSON 格式合法性检查
- 字符编码检查
- 特殊字符转义检查

### 2. Schema Validation / Schema 验证
- StructureModelV2 结构合规性
- 必填字段检查
- 数据类型检查
- 数值范围检查

### 3. Semantic Validation / 语义验证
- 跨引用一致性（节点、材料、截面引用）
- 几何合理性检查
- 荷载组合有效性
- 边界条件完整性

### 4. Missing Field Detection / 缺失字段检测
- 必填字段缺失
- 推荐字段缺失（警告级别）
- 可选字段提示（信息级别）

## Output Format / 输出格式

验证结果包含以下结构：
```json
{
  "valid": boolean,
  "summary": {
    "error_count": number,
    "warning_count": number,
    "info_count": number
  },
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "code": string,
      "message": string,
      "path": string,
      "suggestion": string
    }
  ]
}
```

## Severity Levels / 严重级别

- `error`: 阻断下游执行 / Blocks downstream execution
- `warning`: 告警但不阻断 / Warning but continues
- `info`: 仅记录信息 / Informational only

## Usage Examples / 使用示例

### Basic validation / 基础验证
```
验证以下 JSON: {"schema_version": "2.0.0", "nodes": [...]}
```

### With options / 带选项
```
验证 JSON 结构，包含语义检查，schema 版本 2.0.0
```
