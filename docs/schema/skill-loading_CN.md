# 技能加载机制

## 1. 概述

StructureClaw 的技能（Skill）是模块化、可拆卸的插件，用于扩展 Agent 的结构工程能力。系统支持两种技能来源：

- **内置技能**（Builtin）— 随代码库一起分发，启动时从文件系统自动发现。
- **外部 / SkillHub 技能** — 运行时从 SkillHub 市场安装。

系统遵循 **base-chat 回退原则**：即使没有加载任何工程技能，Agent 仍可作为普通对话助手存在，但不会进入建模、分析或规范校核执行链。

## 2. 内置技能发现与注册

### 2.1 内置技能标准目录形态

内置 skill 位于 `backend/src/agent-skills/<domain>/<skill-id>/`。

每个内置 skill 目录必须包含：

| 文件 | 是否必需 | 用途 |
|------|----------|------|
| `skill.yaml` | 是 | canonical 静态元数据：`id`、`domain`、`capabilities`、兼容性以及域专属字段 |
| `intent.md` / `draft.md` / `analysis.md` / `design.md` 等阶段 Markdown | 可选但通常存在 | 运行时加载的提示词 / 内容资产 |

额外运行时文件仍然由具体域决定，例如：

- analysis skill 可以包含 `runtime.py`
- 可执行的 structure-type plugin 可以包含 `handler.ts`

这些文件属于执行层或内容层，不再负责定义 skill 身份。

### 2.2 发现规则

当前内置 skill 发现已经切到 manifest-first：

1. runtime 递归扫描 `backend/src/agent-skills/`。
2. 只有目录中存在 `skill.yaml`，才会被视为合法内置 skill。
3. `skill.yaml` 通过共享 manifest schema 解析，成为静态真源。
4. 各阶段 Markdown 只作为内容加载，其 frontmatter 不再参与 skill 身份定义。
5. 没有 `skill.yaml` 的目录不会进入内置 skill 注册。

这条规则已经覆盖当前内置域，包括：

- `structure-type`
- `analysis`
- `code-check`
- `load-boundary`
- `validation`
- `report-export`
- `visualization`

### 2.3 Runtime 与 Plugin 层

`skill.yaml` 定义“这个 skill 是什么”，runtime/plugin 模块定义“这个 skill 怎么执行”。

- `AgentSkillLoader.loadBundles()` 读取 `skill.yaml` 与各阶段 Markdown 内容。
- `AgentSkillLoader.loadPlugins()` 仍可为可执行 plugin 附加 `manifest.ts` / `handler.ts` 这类运行时模块，尤其是 `structure-type` 域。
- 这些运行时模块不再是内置 skill 的静态身份真源。

当前内置 skill 加载遵循一条 canonical catalog 规则：

- `/api/v1/agent/skills` 和 `/api/v1/agent/capability-matrix` 是同一份归一化内置 skill catalog 的两个投影。
- 暴露给前端的 skill id 必须使用 canonical id。
- legacy id 只能作为迁移与向后兼容用 alias 保留，不应再作为面向用户的主 id。

当前实现里，`AgentSkillRuntime.listSkillManifests()` 以 `skill.yaml` 文件清单作为运行时 manifest 的主来源。只有当某个可执行 plugin 没有对应的 `skill.yaml` 时，才会追加其 plugin manifest。

当前内置 `structure-type` skill manifest 只直接授权建模相关 tool：

- `build_model`
- `extract_draft_params`

`validate_model`、`run_analysis`、`run_code_check`、`generate_report` 这些执行链 tool 不再由 `structure-type` manifest 直接放行，而是由本轮激活的下游 domain manifests 统一授权。

当前 agent 在进入执行链前，会先显式推导本轮激活的下游 domain skill：

- `analysis` 域根据 `skill.yaml` 中声明的 `analysisType`、`engineId`、结构模型族和显式选择结果选出一个首选 analysis skill。
- `code-check` 域根据 `skill.yaml` 中声明的 `designCode` 建立 skill id 与规范编码之间的映射。
- `validation` 和 `report-export` 通过其 canonical 内置 skill manifest 按需激活。

当前实现里，`validation`、`analysis`、`code-check`、`report-export` 的实际执行入口都已经通过 `AgentSkillRuntime` 统一封装：Agent 不再直接拼接这些域的 registry / artifact 细节，而是通过 runtime 选择 skill、执行 domain，并把选中的 skill id 回写到结果 `meta` 与 tool trace。

## 2.4 内置 Tool 注册

内置 tool 通过 `backend/src/agent-langgraph/tool-registry.ts` 中的 TypeScript 代码注册。

tool 不存在 YAML 发现路径。新增 tool 必须修改代码注册表，在 `backend/src/agent-langgraph/tools.ts` 中实现 handler，并补充 runtime policy 与协议元数据暴露测试。

## 2.5 Runtime 状态投影

当前 `/api/v1/agent/capability-matrix` 还会为每个 skill 和每个 domain summary 暴露 `runtimeStatus`，用于区分“稳定 taxonomy”与“当前运行时接入状态”：

- `active`：已进入主编排，参与激活、授权、执行与 trace。
- `partial`：已接入 runtime，但仍属于平台托管或非完整一等 skill 包。
- `discoverable`：已纳入 taxonomy 与 catalog，但不会自动参与主编排。
- `reserved`：仅保留架构位点，当前未提供实际运行时能力。

### 2.6 分析引擎可用性与 Skill 影响

skill 内声明的 `engineId` 只是静态路由提示，并不等于该 engine 在运行时一定可用。

- skill 可以声明自己面向的分析引擎族。当前内置 engine family 包括 OpenSees、PKPM 和 YJK。
- 真正的运行时 engine 集合来自 engine catalog 以及当前运行健康状态。
- analysis skill 在进入执行前，runtime 必须校验候选 engine 是否：
  - 已启用
  - 当前可用
  - 与所需结构模型族兼容
  - 与请求的分析类型兼容

因此，engine 可用性是一个运行时闸门，会直接影响后续 skill 是否能够参与执行。某个 skill 可以已经成功加载进 taxonomy，但如果它依赖的 engine 当前不可用或不兼容，仍然必须在执行阶段被过滤掉。

### 2.7 skill.yaml 中的 runtimeContract

`skill.yaml` 中的 `runtimeContract` 字段声明了技能如何参与目标调度器的工件图。它用显式的提供者和消费者声明替代了隐式激活。

#### 2.7.1 SkillRole 变体

每个技能通过 `runtimeContract.role` 声明自己的角色。已定义的八种角色：

| 角色 | 描述 |
|------|------|
| `entry` | 管线中的第一个技能。接收原始用户输入并产生初始工件（例如 `structure-type` 产生草稿模型）。 |
| `enricher` | 向已有工件添加信息而不改变其类型（例如向草稿添加荷载/边界条件）。 |
| `validator` | 检查工件的正确性并丰富源工件（例如校验会向 `normalizedModel` 添加质量元数据；不存在单独的 `validationResult` 工件类型）。 |
| `assistant` | 提供指导或解释，不产生或修改工件。 |
| `provider` | 产生其他技能消费的工件。声明 `providerSlot` 供调度器绑定。 |
| `consumer` | 消费其他技能产生的工件。声明 `requiredConsumes` 和/或 `optionalConsumes`。 |
| `designer` | 对工件提出设计修改建议。使用 `providesPatches` 和 `autoIteration` 驱动设计反馈循环。 |
| `transformer` | 将一种工件类型转换为另一种（例如将草稿模型转换为分析输入）。 |

#### 2.7.2 提供者槽位与选择策略

角色为 `provider` 的技能在其运行时合约中声明 `providerSlot`：

```yaml
runtimeContract:
  role: provider
  providerSlot: analysisProvider   # 或 codeCheckProvider
  consumes:
    - analysisModel
  provides:
    - analysisRaw
```

- `providerSlot`：调度器用于将该提供者绑定到工件图中某个工件的稳定标识符。已定义的两个槽位是 `analysisProvider`（对应 `analysisRaw`）和 `codeCheckProvider`（对应 `codeCheckResult`）。
- 调度器的 `planDependencyPath` 在管线状态 `bindings` 中未找到对应绑定时，会以 `'analysisProvider binding required'` 等原因阻断规划。
- 运行时绑定器的 `assertStepAuthorized` 在执行时进行双重检查，确保绑定仍然有效（纵深防御）。

#### 2.7.3 消费者合约

角色为 `consumer` 的技能声明其消费哪些工件：

```yaml
runtimeContract:
  role: consumer
  targetArtifact: reportArtifact
  requiredConsumes:
    - designBasis
    - normalizedModel
  optionalConsumes:
    - postprocessedResult
    - codeCheckResult
```

- `requiredConsumes`：该技能执行前必须可用的工件。如果任何必需消费缺失，调度器会先规划生产该工件，或报告阻断原因。
- `optionalConsumes`：可以增强该技能输出但非强制要求的工件。技能必须能够优雅地处理这些工件的缺失。

#### 2.7.4 设计者合约

角色为 `designer` 的技能通过调度器的设计反馈循环提出设计修改建议。设计者步骤在后处理和规范校核完成后触发（规范 7.3、13.3 节）：

```yaml
runtimeContract:
  role: designer
  consumes:
    - designBasis
    - normalizedModel
  provides:
    - normalizedModel
```

- `consumes`：设计者用于形成方案的输入工件（通常是 `designBasis`、`normalizedModel`，以及可选的 `postprocessedResult` / `codeCheckResult`）。
- `provides`：设计者修改的目标工件（通常是 `normalizedModel`）。
- 调度器的 `planDesignFeedback()` 方法控制反馈循环：当 `autoDesignIterationPolicy.enabled` 为 true 时，设计者步骤以 `execute` 模式运行；否则以 `propose` 模式运行并创建 `design-proposal` 检查点等待用户确认。
- 最大迭代次数和验收标准由 `ProjectExecutionPolicy` 中的 `autoDesignIterationPolicy`（不在 skill manifest 中）控制。

#### 2.7.5 示例

分析技能的完整 `runtimeContract` 声明：

```yaml
id: opensees-static
domain: analysis
runtimeContract:
  role: provider
  providerSlot: analysisProvider
  consumes:
    - analysisModel
  provides:
    - analysisRaw
```

报告导出消费者技能：

```yaml
id: report-export-builtin
domain: report-export
runtimeContract:
  role: consumer
  targetArtifact: reportArtifact
  requiredConsumes:
    - designBasis
    - normalizedModel
  optionalConsumes:
    - postprocessedResult
    - codeCheckResult
```

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

已安装状态持久化于 `~/.structureclaw/skillhub/installed.json`。

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
3. **不再隐式执行工程工具**：`build_model`、`run_analysis`、`run_code_check`、`generate_report` 等外接 tool 必须先由已启用 skill 授权。
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
