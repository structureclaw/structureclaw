# 技能加载机制

## 1. 概述

StructureClaw 的技能（Skill）是模块化、可拆卸的插件，用于扩展 Agent 的结构工程能力。系统支持两种技能来源：

- **内置技能**（Builtin）— 随代码库一起分发，启动时从文件系统自动发现。
- **外部 / SkillHub 技能** — 运行时从 SkillHub 市场安装。

系统遵循 **base-chat 回退原则**：即使没有加载任何工程技能，Agent 仍可作为普通对话助手存在，但不会进入建模、分析或规范校核执行链。

## 2. 内置技能发现与注册

### 2.1 分析技能

分析技能位于 `backend/src/agent-skills/analysis/` 目录下，每个技能是一个子目录，需要包含：

| 文件 | 是否必需 | 用途 |
|------|----------|------|
| `intent.md` | 是 | 前置元数据（id、software、analysisType、engineId 等） |
| `runtime.py` | 是 | 分析引擎的 Python 执行脚本 |

**发现流程**（`analysis/registry.ts`）：

1. `discoverBuiltinAnalysisSkills()` 扫描分析根目录下的所有子目录。
2. 以 `.` 开头或名为 `runtime` 的目录将被跳过。
3. 对每个目录，`toAnalysisSkillManifest()` 检查是否存在 `intent.md` 和 `runtime.py`。
4. 如果缺少任一文件，将记录警告并跳过该目录。
5. 解析 `intent.md` 前置元数据中的必需字段：`id`、`software`、`analysisType`、`engineId`、`adapterKey`。
6. 缺少必需字段时，将记录警告并指明具体缺失的字段名。
7. 有效技能按优先级降序排列，相同优先级按 id 字母顺序排列。
8. 输出发现摘要日志：`"N skills loaded, M skipped"`。

**内置分析引擎：**

| 引擎 ID | 适配器 | 优先级 | 路由提示 |
|---------|--------|--------|----------|
| `builtin-opensees` | OpenSees | 100 | 高精度、默认 |
| `builtin-simplified` | Simplified | 10 | 回退、快速 |

### 2.2 结构类型技能

结构类型技能位于 `backend/src/agent-skills/structure-type/` 目录下，每个技能有一个 `manifest.ts` 文件导出元数据。

**注册流程**（`structure-type/registry.ts`）：

1. `listStructureModelingProviders()` 接受内置插件和可选的外部提供者。
2. 插件通过 `toStructureModelingProvider()` 转换为 `StructureModelingProvider`。
3. 所有提供者传入 `loadSkillProviders()` 进行去重和排序。

### 2.3 其他技能域

| 域 | 位置 | 注册方式 |
|----|------|----------|
| `analysis` | `agent-skills/analysis/` | 文件系统发现 + manifest 归一化 |
| `code-check` | `agent-skills/code-check/` | 提供者注册表，带 filter/finalize 回调 |
| `data-input` | `agent-skills/data-input/` | 插件清单 |
| `design` | `agent-skills/design/` | 插件清单 |
| `drawing` | `agent-skills/drawing/` | 插件清单 |
| `general` | `agent-skills/general/` | 插件清单 |
| `load-boundary` | `agent-skills/load-boundary/` | 插件清单 |
| `material` | `agent-skills/material/` | 插件清单 |
| `visualization` | `agent-skills/visualization/` | 插件清单 |
| `result-postprocess` | `agent-skills/result-postprocess/` | 插件清单 |
| `report-export` | `agent-skills/report-export/` | 运行时生成内置 manifest |
| `section` | `agent-skills/section/` | 插件清单 |
| `validation` | `agent-skills/validation/` | 运行时生成内置 manifest |

当前实现里，`AgentSkillRuntime.listSkillManifests()` 会把 `structure-type` 插件 manifest 与一组内置 domain manifest 合并后统一暴露给能力矩阵和 tool 授权层。这组运行时生成的 manifest 当前覆盖：

- `analysis`
- `code-check`
- `report-export`
- `validation`

当前内置 `structure-type` skill manifest 只直接授权建模相关 tool：

- `draft_model`
- `update_model`

`validate_model`、`run_analysis`、`run_code_check`、`generate_report` 这些执行链 tool 不再由 `structure-type` manifest 直接放行，而是由本轮激活的下游 domain manifests 统一授权。

当前 agent 在进入执行链前，会先显式推导本轮激活的下游 domain skill：

- `analysis` 域按 `analysisType`、`engineId`、结构模型族和显式选择结果选出一个首选 analysis skill。
- `code-check` 域按 `designCode` 选出一个对应的规范 skill。
- `validation` 和 `report-export` 由当前上下文按需激活内置 domain manifest。

当前实现里，`validation`、`analysis`、`code-check`、`report-export` 的实际执行入口都已经通过 `AgentSkillRuntime` 统一封装：Agent 不再直接拼接这些域的 registry / artifact 细节，而是通过 runtime 选择 skill、执行 domain，并把选中的 skill id 回写到结果 `meta` 与 tool trace。

当前 `/api/v1/agent/capability-matrix` 还会为每个 skill 和每个 domain summary 暴露 `runtimeStatus`，用于区分“稳定 taxonomy”与“当前运行时接入状态”：

- `active`：已进入主编排，参与激活、授权、执行与 trace。
- `partial`：已接入 runtime，但仍属于平台托管或非完整一等 skill 包。
- `discoverable`：已纳入 taxonomy，但当前尚未进入主编排。
- `reserved`：仅保留架构位点，当前未提供实际运行时能力。

## 3. 外部 / SkillHub 技能打包与加载

### 3.1 包元数据

每个技能（内置或外部）由 `SkillPackageMetadata` 描述：

```typescript
interface SkillPackageMetadata {
  id: string;                    // 唯一标识符
  domain: SkillDomain;           // 例如 'structure-type', 'code-check'
  version: string;               // 语义化版本，如 '1.0.0'
  source: 'builtin' | 'skillhub';
  capabilities: string[];
  compatibility: {
    minRuntimeVersion: string;   // 所需的最低运行时版本
    skillApiVersion: string;     // 必须精确匹配，如 'v1'
  };
  entrypoints: {                 // 按键名的模块入口路径
    [key: string]: string | undefined;
  };
  enabledByDefault: boolean;
  priority?: number;
  requires?: string[];           // 必须同时加载的技能 ID
  conflicts?: string[];          // 不能共存的技能 ID
  supportedLocales?: string[];
  supportedAnalysisTypes?: string[];
  materialFamilies?: string[];
}
```

### 3.2 加载管道

外部技能通过 `loadExecutableSkillProviders()` 的三阶段管道加载：

```
入口点 → 导入 → 校验
```

| 阶段 | 检查内容 | 失败原因 |
|------|----------|----------|
| **入口点** | 包元数据中 `entrypoints[key]` 存在 | `missing_entrypoint` |
| **导入** | `importModule(specifier, pkg)` 成功 | `import_failed` |
| **校验** | `validateModule(module, pkg)` 无错误 | `invalid_provider` |

每个失败记录包含：包 ID、版本、域、来源、阶段、原因和可选的详细信息。

### 3.3 SkillHub 生命周期

来自 SkillHub 的技能遵循 `AgentSkillHubService` 管理的生命周期：

```
搜索 → 安装 → 启用 ↔ 禁用 → 卸载
```

- **搜索**：查询目录，对每个条目评估兼容性和完整性。
- **安装**：验证完整性（校验和 + 签名），评估兼容性，记录到 `installed.json`。
- **启用/禁用**：切换已安装状态中的 `enabled` 标志。
- **卸载**：从已安装状态中移除技能记录。

已安装状态持久化于 `.runtime/skillhub/installed.json`。

## 4. 元数据、版本、依赖与兼容性

### 4.1 版本兼容性

兼容性由 `skill-shared/loader.ts` 中的 `evaluateSkillCompatibility()` 评估：

| 字段 | 比较方式 | 规则 |
|------|----------|------|
| `minRuntimeVersion` | 语义化版本数值比较 | 技能要求运行时版本 ≥ 此版本 |
| `skillApiVersion` | 精确字符串匹配 | 必须与当前 API 版本完全一致 |

**不兼容原因码：**

- `runtime_version_incompatible` — 运行时版本低于技能要求。
- `skill_api_version_incompatible` — 技能 API 版本不匹配。

当前默认值（可通过环境变量覆盖）：

- `SCLAW_RUNTIME_VERSION` → 默认 `'0.1.0'`
- `SCLAW_SKILL_API_VERSION` → 默认 `'v1'`

### 4.2 依赖解析

依赖由 `skill-shared/loader.ts` 中的 `resolveSkillDependencies()` 解析：

| 字段 | 语义 |
|------|------|
| `requires` | 列表中的所有技能 ID 必须存在于已加载的提供者集中 |
| `conflicts` | 列表中的所有技能 ID 不能存在于已加载的提供者集中 |

**解析规则：**

1. 没有匹配包条目的提供者直接通过，不做检查。
2. `requires` 未满足的提供者将被拒绝，原因为 `unmet_requires`。
3. 存在活跃 `conflicts` 的提供者将被拒绝，原因为 `conflict_detected`。
4. 拒绝不会抛出异常 — 提供者被静默排除，系统继续运行。

### 4.3 提供者加载顺序

`loadSkillProviders()` 按以下顺序处理提供者：

```
合并 → 过滤 → 排序 → 去重 → 依赖解析 → 后处理
```

1. **合并**：将内置和外部提供者合并为一个列表。
2. **过滤**：应用可选的 filter 回调排除提供者。
3. **排序**：按可配置的优先级顺序排序（默认按 priority 降序），然后内置优先于 skillhub，最后按 id 字母顺序。
4. **去重**：保留排序后每个提供者 ID 的首次出现者；在默认 `priorityOrder: 'desc'` 时，这对应于「最高优先级胜出」。
5. **依赖解析**：提供 `packages` Map 时，检查 `requires`/`conflicts`。
6. **后处理**：应用可选的 finalize 回调。

## 5. 失败处理与回退行为

### 5.1 外部技能加载失败

`loadExecutableSkillProviders()` 的失败是结构化的、可聚合的：

```typescript
interface ExecutableSkillProviderLoadFailure {
  packageId: string;
  packageVersion: string;
  domain: string;
  source: string;
  stage: 'entrypoint' | 'import' | 'validate';
  reason: 'missing_entrypoint' | 'import_failed' | 'invalid_provider';
  detail?: string;
}
```

使用 `summarizeSkillLoadResult()` 进行聚合：

```typescript
interface SkillLoadSummary {
  loaded: number;
  failed: number;
  failuresByReason: Record<string, number>;
  failureDetails: Array<{ packageId: string; reason: string; detail?: string }>;
}
```

### 5.2 不兼容技能处理

当 SkillHub 技能在安装时兼容性评估失败：

- 技能仍然被记录到 `installed.json`。
- `compatibilityStatus` 设为 `'incompatible'`。
- `incompatibilityReasons` 列出具体原因码。
- 技能**不会自动启用**。
- `fallbackBehavior` 设为 `'baseline_only'`。

### 5.3 完整性失败处理

当 SkillHub 技能完整性验证失败（校验和或签名不匹配）：

- 安装被**完全拒绝**。
- `integrityStatus` 设为 `'rejected'`。
- `fallbackBehavior` 设为 `'baseline_only'`。

### 5.4 空技能集合行为

当没有加载任何技能（`skillIds` 明确为空数组）时，系统停留在 **base chat 路径**：

1. **工程会话状态重置**：清空 skill 相关草稿、结构类型 carry-over 和缓存模型状态。
2. **仅保留对话能力**：Agent 仍可用普通对话方式帮助用户澄清需求。
3. **不再隐式执行工程工具**：`draft_model`、`run_analysis`、`run_code_check`、`generate_report` 等外接 tool 必须先由已启用 skill 授权。
4. 如果调用方强制要求执行 tool，而当前没有启用 skill，请求会以 `NO_EXECUTABLE_TOOL` 阻断。

### 5.5 失败策略汇总

| 场景 | 行为 | 用户影响 |
|------|------|----------|
| 外部技能入口点缺失 | 跳过，记录失败 | 其他技能正常加载 |
| 外部技能导入错误 | 跳过，捕获错误详情 | 其他技能正常加载 |
| 外部技能校验失败 | 跳过，记录校验错误 | 其他技能正常加载 |
| 依赖 `requires` 未满足 | 从加载集中排除 | 系统继续运行 |
| 依赖 `conflicts` 检测到 | 从加载集中排除 | 系统继续运行 |
| 版本不兼容 | 已安装但不启用 | 在已安装列表中可见 |
| 完整性检查失败 | 安装被拒绝 | 不记录为已安装 |
| 所有技能不可用 | 停留在 base chat 路径 | 仍可对话，但工程执行被阻断 |

## 6. 相关文件

| 文件 | 用途 |
|------|------|
| `backend/src/skill-shared/loader.ts` | 核心加载、排序、去重、依赖解析、兼容性检查 |
| `backend/src/skill-shared/package.ts` | SkillPackageMetadata 定义与规范化 |
| `backend/src/skill-shared/provider.ts` | BaseSkillProvider 接口 |
| `backend/src/agent-skills/analysis/registry.ts` | 分析技能文件系统发现 |
| `backend/src/agent-skills/structure-type/registry.ts` | 结构类型提供者注册表 |
| `backend/src/services/agent-skillhub.ts` | SkillHub 安装/启用/禁用/卸载服务 |
