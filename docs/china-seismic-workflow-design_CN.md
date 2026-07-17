# 中国抗震全流程设计文档

本文档描述 StructureClaw 面向中国建筑抗震设计的目标流程、skill 架构、当前实现边界和后续路线。它不是只覆盖 MVP；前半部分定义完整目标设计，后半部分记录本分支已经落地的首个可执行闭环和尚未完成的能力。

## 1. 目标

StructureClaw 应支持基于 OpenSees 的中国建筑抗震分析全流程：

- 从自然语言设计需求中理解地区、设防水准、结构类型、规则性、性能目标和分析偏好。
- 按 `GB 55002-2021` 与 `GB/T 50011-2010（2024年版）` 建立设计依据。
- 自动选择反应谱法、时程分析法或二者组合。
- 支持地震波输入、选波、调幅、反应谱一致性校核和时程结果统计。
- 使用 OpenSees 执行模态、反应谱、弹性时程和后续弹塑性分析。
- 生成可审计的规范依据、方法选择理由、计算结果、规范校核和中英文报告。

成功标准不是“识别几个关键词”，而是形成可复现、可解释、可测试的抗震设计执行链。

## 2. 规范基线

截至 2026-07-07，本功能的规范基线为：

| 用途 | 文件 | 状态 |
|---|---|---|
| 强制性底线 | `GB 55002-2021 建筑与市政工程抗震通用规范` | 2022-01-01 实施；现行工程建设标准中有关规定与其不一致时，以本规范为准。 |
| 建筑抗震详细方法 | `GB/T 50011-2010 建筑抗震设计标准` | 2024 局部修订后，原《建筑抗震设计规范》改名为《建筑抗震设计标准》，自 2024-08-01 实施。 |
| 地震动参数 | `GB 18306-2015 中国地震动参数区划图` + 2026-02-27 起实施的第1号修改单 | 当前正式标准依据；全国标准信息公共服务平台同时列出完整修订计划 `20260055-Q-419` 正在起草，因此草案或修订计划内容在正式替代当前标准前不能作为正式设计依据。 |
| 设防分类 | `GB 50223-2008 建筑工程抗震设防分类标准` | 用于确定特殊设防类、重点设防类、标准设防类和适度设防类。 |

实现中应将规范版本写入所有分析结果和报告，不应只写“GB50011”。兼容旧触发词时，展示名称仍应升级为 `GB 55002-2021 + GB/T 50011-2010（2024年版）`。

参考链接：

- 住建部 `GB 55002-2021` 公告：https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_761174.html
- 住建部 `GB/T 50011-2010` 2024 局部修订公告：https://www.mohurd.gov.cn/gongkai/zhengce/zhengcefilelib/202405/20240523_778179.html
- 全国标准信息公共服务平台 `GB 18306-2015`：https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=EC0585F90CA21ABE02826394F266B623

## 3. 非目标

第一阶段不做下列事情：

- 不替代注册结构工程师的最终审查。
- 不内置版权或授权不明的地震波库。
- 不一次覆盖所有复杂体系、隔震、消能减震、超限专项审查和全部性能化设计细节。
- 不让 LLM 输出最终工程校核结论；LLM 只输出结构化意图、解释和追问信息。
- 不用正则表达式或关键词扫描完成工程意图判断。

## 4. 核心架构原则

### 4.1 LLM 理解，确定性代码执行

LLM 负责把自然语言转成结构化设计意图。确定性代码负责：

- 规范参数归一化。
- 规范条文触发条件判断。
- 设计谱生成。
- 地震波调幅和谱一致性校核。
- OpenSees 分析。
- 数值结果后处理。
- 规范校核。

LLM 不直接决定数值是否合格，也不直接执行规范公式。

### 4.2 禁止关键词和正则路由

不得使用以下方式判断用户意图：

```ts
if (message.includes('时程')) method = 'time_history';
if (/反应谱|response spectrum/i.test(message)) method = 'response_spectrum';
if (message.includes('8度')) intensity = 8;
```

允许使用正则或结构化解析的范围仅限：

- 文件格式解析，例如 CSV、AT2、JSON、文本波形数据。
- 数值单位规范化，例如 `cm/s2` 到 `m/s2`。
- 已结构化字段的格式校验，例如 `designGroup` 是否属于枚举。

工程意图、分析方法偏好、设防类别、缺参追问和下一步动作必须来自 LLM 的结构化输出，或来自已经结构化的项目状态。

### 4.3 每个自动选择必须可解释

系统自动选择分析方法时，必须输出 `selectionReasons`，说明理由来自：

- 用户显式意图。
- `GB 55002-2021` 强制要求。
- `GB/T 50011-2010（2024年版）` 方法要求。
- StructureClaw 的工程保守策略。

报告中应显示这些理由，而不是只显示最终方法。

## 5. 现有代码边界

当前仓库已有可复用边界：

| 位置 | 当前职责 | 设计影响 |
|---|---|---|
| `backend/src/agent-runtime/` | skill 加载、draft、模型构建、执行编排 | 新增语义合同和 draft 字段时应从这里进入。 |
| `backend/src/agent-langgraph/tools.ts` | `run_analysis`、`run_code_check`、`generate_report` 等工具 | 需要扩展 `run_analysis` 参数通道，支持抗震 workflow 参数。 |
| `backend/src/agent-skills/analysis/opensees-seismic/` | 当前 OpenSees 抗震分析 skill | 应成为中国抗震 workflow 的主执行 skill。 |
| `backend/src/agent-skills/analysis/opensees-dynamic/` | 模态和时程动力分析 | 应作为底层执行能力，不承担规范方法选择。 |
| `backend/src/agent-skills/load-boundary/seismic-load/` | 地震荷载生成 | 应升级为设计依据、反应谱、等效地震作用的确定性模块。 |
| `backend/src/agent-skills/code-check/gb50011/` | 最小抗震校核 | 应升级为新版规范口径，并保留旧 ID 兼容。 |
| `backend/src/agent-skills/result-postprocess/` | 结果后处理入口 | 应增加 OpenSees 抗震结果标准化。 |
| `backend/src/agent-skills/report-export/` | 报告导出 | 应增加抗震计算书模板。 |

## 6. 目标流程

```text
用户自然语言
  -> LLM 语义理解：SeismicDesignIntent
  -> 确定性完整性检查：SeismicDesignBasisCompleteness
  -> 必要时 LLM 追问或确认假设
  -> 设计依据归一化：SeismicDesignBasis
  -> 方法选择器：SeismicMethodDecision
  -> 反应谱生成 / 地震波选择与调幅
  -> OpenSees 模态、反应谱、时程或弹塑性分析
  -> 结果后处理：楼层响应、包络、平均、控制结果
  -> 规范校核：GB 55002 + GB/T 50011
  -> 报告：中文和英文
```

## 7. 语义理解合同

新增 `SeismicDesignIntent` 合同。该对象由 LLM 输出，不能由关键词扫描拼装。

```ts
export interface SeismicDesignIntent {
  task: 'design' | 'analysis' | 'code_check' | 'report' | 'comparison' | 'question';
  designCodeFamily: 'china_seismic';
  designBasis?: {
    region?: string;
    intensity?: 6 | 7 | 8 | 9;
    designBasicAccelerationG?: number;
    designGroup?: 'first' | 'second' | 'third';
    siteCategory?: 'I0' | 'I1' | 'II' | 'III' | 'IV';
    fortificationCategory?: 'special' | 'key' | 'standard' | 'moderate';
    seismicGrade?: 1 | 2 | 3 | 4;
    importanceFactor?: number;
    dampingRatio?: number;
    earthquakeLevel?: 'frequent' | 'fortification' | 'rare';
    performanceObjective?: 'basic' | 'performance_based' | 'normal_use_after_fortification';
    seismicSafetyEvaluation?: {
      approved: boolean;
      reportId?: string;
      intensity?: 6 | 7 | 8 | 9;
      designBasicAccelerationG?: number;
      designGroup?: 'first' | 'second' | 'third';
      characteristicPeriod?: number;
      rareCharacteristicPeriod?: number;
      alphaMax?: number;
    };
  };
  structureProfile?: {
    structureType?: string;
    materialFamily?: 'steel' | 'concrete' | 'composite' | 'masonry' | 'timber' | 'generic';
    heightM?: number;
    storyCount?: number;
    regularity?: 'regular' | 'irregular' | 'particularly_irregular' | 'unknown';
    hasLargeSpan?: boolean;
    hasLongCantilever?: boolean;
    hasIsolation?: boolean;
    hasEnergyDissipation?: boolean;
  };
  requestedMethod?: {
    preference?: 'auto' | 'response_spectrum' | 'time_history' | 'pushover' | 'elastic_plastic_time_history';
    userExplicit?: boolean;
    reasonZh?: string;
    reasonEn?: string;
  };
  groundMotionRequirement?: {
    source?: 'user_uploaded' | 'local_catalog' | 'generated_artificial' | 'auto';
    recordCount?: number;
    targetEarthquakeLevel?: 'frequent' | 'fortification' | 'rare';
    directions?: Array<'X' | 'Y' | 'Z'>;
  };
  missingFields: string[];
  assumptions: Array<{ zh: string; en: string }>;
  confidence: number;
}
```

LLM 输出后，确定性代码只做 schema 校验、枚举校验、范围校验和缺参判断。若 LLM 低置信或缺少关键字段，系统应追问，不应猜测。

## 8. 设计依据归一化

`SeismicDesignBasis` 是计算层输入。它必须来自结构化 intent、用户确认、项目设置或模型元数据。

```ts
export interface SeismicDesignBasis {
  codeBasis: {
    mandatoryCode: 'GB55002-2021';
    designStandard: 'GBT50011-2010-2024';
    groundMotionZonation: 'GB18306-2015';
  };
  region?: string;
  intensity: 6 | 7 | 8 | 9;
  designBasicAccelerationG: number;
  designGroup: 'first' | 'second' | 'third';
  siteCategory: 'I0' | 'I1' | 'II' | 'III' | 'IV';
  characteristicPeriodS: number;
  dampingRatio: number;
  fortificationCategory: 'special' | 'key' | 'standard' | 'moderate';
  seismicGrade?: 1 | 2 | 3 | 4;
  importanceFactor: number;
  earthquakeLevels: Array<'frequent' | 'fortification' | 'rare'>;
  performanceObjective: 'basic' | 'performance_based' | 'normal_use_after_fortification';
  sourceTrace: Array<{
    field: string;
    source: 'user' | 'settings' | 'gb18306' | 'model' | 'assumption';
    noteZh: string;
    noteEn: string;
  }>;
}
```

完整性检查至少要求：

- 设防烈度或设计基本地震加速度。
- 设计地震分组。
- 场地类别。
- 设防类别。
- 阻尼比，若缺失可按结构类型提出默认建议，但需用户确认或写入假设。
- 结构高度和规则性，若要自动判断是否需要时程分析。

## 9. 方法选择器

方法选择器不是 LLM。它接收结构化 intent、设计依据和模型摘要，按确定性规则输出决策。

```ts
export interface SeismicMethodDecision {
  primaryMethod: 'response_spectrum' | 'time_history' | 'elastic_plastic_time_history';
  requiredMethods: Array<'modal' | 'response_spectrum' | 'time_history' | 'pushover' | 'elastic_plastic_time_history'>;
  earthquakeLevels: Array<'frequent' | 'fortification' | 'rare'>;
  groundMotionCount?: number;
  resultCombinationRule:
    | 'spectrum_only'
    | 'max_of_spectrum_and_time_history_envelope'
    | 'max_of_spectrum_and_time_history_mean';
  requiresUserConfirmation: boolean;
  blockingMissingFields: string[];
  selectionReasons: Array<{
    source: 'user_intent' | 'GB55002-2021' | 'GBT50011-2010-2024' | 'structureclaw_policy';
    clauseHint?: string;
    zh: string;
    en: string;
  }>;
}
```

初始规则：

| 条件 | 方法 |
|---|---|
| 常规建筑，未触发时程要求 | 振型分解反应谱法。 |
| 用户显式要求时程 | 反应谱法作为基准，同时执行时程分析。 |
| 特别不规则建筑 | 多遇地震下追加时程补充计算。 |
| 特殊设防类建筑 | 多遇地震下追加时程补充计算；性能目标可能进一步要求设防地震或罕遇地震分析。 |
| 7 度或 8 度 I、II 类场地且高度大于 100 m | 多遇地震下追加时程补充计算。 |
| 8 度 III、IV 类场地且高度大于 80 m | 多遇地震下追加时程补充计算。 |
| 9 度且高度大于 60 m | 多遇地震下追加时程补充计算。 |
| 罕遇地震弹塑性变形验算、性能化、大震不倒验证 | 静力弹塑性或弹塑性时程路径，OpenSees 非线性能力不足时阻塞并说明缺项。 |
| 隔震或消能减震 | 进入专门分析路径；当前实现会返回结构化能力边界，直到专门的隔震/消能装置分析能力落地。 |

时程结果组合规则：

- 3 组加速度时程：取时程法包络值与反应谱法结果的较大值。
- 7 组及以上加速度时程：取时程法平均值与反应谱法结果的较大值。
- 弹性时程每条底部剪力不应小于反应谱法结果的 65%。
- 多条时程底部剪力平均值不应小于反应谱法结果的 80%。

## 10. 反应谱模块

反应谱模块应是确定性 Python 模块，建议放在 `analysis/opensees-seismic/` 内部：

```text
opensees-seismic/
  design_basis.py
  method_decision.py
  response_spectrum.py
  modal_combination.py
  floor_response.py
  ground_motion.py
  time_history.py
  code_checks.py
```

`response_spectrum.py` 应负责：

- 根据设防烈度、设计基本地震加速度、设计地震分组、场地类别、阻尼比生成水平地震影响系数曲线。
- 支持多遇、设防、罕遇地震水准。
- 对周期超过规范常规范围的情况输出 `requiresSpecialStudy`。
- 输出谱曲线、关键参数、来源和警告。

反应谱计算结果：

```ts
export interface ResponseSpectrumAnalysisResult {
  status: 'success' | 'failed';
  designBasis: SeismicDesignBasis;
  spectrum: Array<{ periodS: number; alpha: number; acceleration?: number }>;
  modal: {
    modes: Array<{
      modeNumber: number;
      periodS: number;
      frequencyHz: number;
      participationX?: number;
      participationY?: number;
      effectiveMassRatioX?: number;
      effectiveMassRatioY?: number;
    }>;
    massParticipationSummary: Record<string, number>;
  };
  floorResponses: Array<{
    story: string;
    elevationM: number;
    shearXKN?: number;
    shearYKN?: number;
    storyShearKN?: number;
    cumulativeWeightKN?: number;
    shearWeightRatio?: number;
    driftRatioX?: number;
    driftRatioY?: number;
  }>;
  baseShear: { xKN?: number; yKN?: number };
  warnings: string[];
}
```

## 11. 地震波与时程模块

第一阶段支持三类地震波来源：

- 用户上传文件。
- 用户配置本地波库目录。
- 人工模拟波。

不得把授权不明的波形数据提交到仓库。

```ts
export interface GroundMotionRecord {
  id: string;
  source: 'uploaded' | 'local_catalog' | 'artificial';
  dtS: number;
  acceleration: number[];
  unit: 'm/s2' | 'cm/s2' | 'g';
  direction: 'X' | 'Y' | 'Z';
  scaleFactor?: number;
  metadata?: {
    eventName?: string;
    station?: string;
    magnitude?: number;
    distanceKm?: number;
    siteClass?: string;
  };
}
```

选波和调幅结果：

```ts
export interface GroundMotionSelectionResult {
  targetSpectrum: Array<{ periodS: number; alpha: number }>;
  records: GroundMotionRecord[];
  scaledSpectra: Array<Array<{ periodS: number; alpha: number }>>;
  averageSpectrum: Array<{ periodS: number; alpha: number }>;
  checks: {
    realRecordRatioOk: boolean;
    spectrumCompatibilityOk: boolean;
    maxScaleFactor?: number;
    scaleFactorLimit?: number;
    singleBaseShear65Ok?: boolean;
    averageBaseShear80Ok?: boolean;
  };
  warnings: string[];
}
```

时程分析结果：

```ts
export interface TimeHistoryAnalysisResult {
  status: 'success' | 'failed';
  recordResults: Array<{
    recordId: string;
    scaleFactor: number;
    maxBaseShearXKN?: number;
    maxBaseShearYKN?: number;
    maxRoofDisplacementM?: number;
    maxDriftRatio?: number;
    floorEnvelope: Array<{
      story: string;
      shearXKN?: number;
      shearYKN?: number;
      driftRatioX?: number;
      driftRatioY?: number;
    }>;
  }>;
  statistics: {
    envelope?: Record<string, unknown>;
    mean?: Record<string, unknown>;
    controllingCombination: 'envelope' | 'mean';
  };
  compatibilityChecks: GroundMotionSelectionResult['checks'];
  warnings: string[];
}
```

## 12. Skill 架构设计

### 12.1 新增或升级的 skills

| Skill | 类型 | 职责 |
|---|---|---|
| `general/china-seismic-design-intent` | 新增 | LLM 语义理解中国抗震设计需求，输出 `SeismicDesignIntent`。 |
| `load-boundary/seismic-load` | 升级 | 从“地震荷载生成”升级为设计依据、设计谱、重力荷载代表值和等效地震作用的确定性模块。 |
| `analysis/opensees-seismic` | 升级 | 中国抗震 workflow 主入口，支持 `auto`、反应谱、时程、Pushover、弹塑性时程的分阶段能力。 |
| `analysis/opensees-dynamic` | 保留并收敛职责 | 底层模态和时程执行器，不做规范方法选择。 |
| `code-check/gb50011` | 升级 | 保留 ID 兼容，展示和报告升级为 `GB 55002-2021 + GB/T 50011-2010（2024年版）`。 |
| `result-postprocess/opensees-seismic` | 新增或扩展 | 标准化楼层响应、包络、平均、控制结果和可视化数据。 |
| `report-export/seismic-cn` | 新增或扩展 | 生成中英文抗震计算书。 |

### 12.2 Skill 选择原则

- 结构类型 skill 继续负责建模。
- 语义 intent skill 负责理解用户是否要做中国抗震设计、目标水准和偏好。
- analysis skill 负责执行。
- code-check skill 负责规范校核。
- report skill 负责输出。

不得让 analysis skill 通过读取用户原文关键词自行改变方法。analysis skill 只能读取 `SeismicWorkflowRequest`。

## 13. Tool 和 runtime 合同调整

当前 `run_analysis` schema 只有 `analysisType` 和少量参数，无法表达抗震 workflow。建议增加可选参数：

```ts
export interface RunAnalysisInput {
  analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
  floorLoadTransferMode?: 'auto_code_cn' | 'node_tributary' | 'one_way_slab' | 'two_way_slab';
  seismicWorkflow?: SeismicWorkflowRequest;
}
```

```ts
export interface SeismicWorkflowRequest {
  intent: SeismicDesignIntent;
  designBasis: SeismicDesignBasis;
  methodDecision: SeismicMethodDecision;
  responseSpectrumOptions?: {
    modalCombination?: 'CQC' | 'SRSS';
    directions?: Array<'X' | 'Y'>;
  };
  groundMotions?: GroundMotionRecord[];
  timeHistoryOptions?: {
    integration?: 'Newmark';
    timeStepS?: number;
    durationS?: number;
    dampingModel?: 'rayleigh' | 'modal';
  };
  outputOptions?: {
    includeRawTimeSeries?: boolean;
    includeFloorEnvelope?: boolean;
    includeMemberForceEnvelope?: boolean;
  };
}
```

如果对话工具层未传 `seismicWorkflow`，但 `analysisType='seismic'`，`run_analysis` 应返回 `SEISMIC_WORKFLOW_REQUIRED`，要求先由 LLM 语义理解生成结构化 workflow。底层 runtime 可保留旧参数兼容路径，用于低层合同和历史调用，但完整中国抗震流程必须以 `seismicWorkflow` 为入口。底层直接调用如果省略 `seismicWorkflow`，结果必须标记 `workflowInputMode="legacy_compatibility_parameters"` 并附带警告，避免被误认为结构化中国抗震流程。

## 14. Agent 交互策略

### 14.1 缺参追问

关键字段缺失时应追问：

- 项目地区或设防烈度/加速度。
- 设计地震分组。
- 场地类别。
- 设防类别。
- 结构高度和规则性。
- 用户要求时程时的地震波来源。

追问由 LLM 生成，但缺参列表由确定性完整性检查给出。

### 14.2 假设确认

可以提出默认假设，但必须显式记录。例如：

- 阻尼比按 0.05。
- 先按标准设防类。
- 先按规则结构。
- 地震作用先计算两个主轴方向。

如果假设会改变方法选择或校核结论，需要用户确认。

## 15. 报告设计

抗震报告应包含：

- 项目输入和设计依据。
- 规范版本。
- LLM 理解摘要。
- 缺失信息和采用假设。
- 方法选择理由。
- 反应谱参数和谱曲线。
- 模态结果和质量参与。
- 时程波组、调幅系数、谱一致性检查。
- 65% / 80% 底部剪力校核。
- 楼层剪力、层间位移角和控制结果。
- 构件抗震校核摘要。
- 风险和限制。

所有用户可见文本必须支持 `zh` 和 `en`。

## 16. 测试计划

| 测试层级 | 内容 |
|---|---|
| LLM 合同测试 | 自然语言输入应得到合法 `SeismicDesignIntent`，不测试关键词命中。 |
| 规则单元测试 | 方法选择、高度阈值、时程组合规则、65%/80% 校核。 |
| 反应谱单元测试 | 设计谱参数、阻尼修正、特征周期、异常周期警告。 |
| 地震波测试 | 文件解析、单位转换、调幅、平均谱、真实波比例。 |
| OpenSees 集成测试 | 简单框架模态、反应谱、弹性时程稳定运行。 |
| 端到端测试 | `build_model -> validate_model -> run_analysis(seismic) -> run_code_check -> generate_report`。 |
| 双语测试 | 中英文报告均包含规范版本、方法理由和校核结论。 |

建议命令：

```bash
npm test --prefix backend -- --runInBand
node tests/runner.mjs validate validate-agent-orchestration
node tests/runner.mjs validate validate-analyze-contract
node tests/runner.mjs validate validate-chat-stream-contract
```

涉及前端设置或报告 UI 时，再补充：

```bash
npm run type-check --prefix frontend
npm run test:run --prefix frontend
```

## 17. 分阶段实施计划

### Phase 0: 设计和合同

- 增加本文档。
- 增加 `SeismicDesignIntent`、`SeismicDesignBasis`、`SeismicMethodDecision` schema 草案。
- 明确禁止关键词/正则意图判断的测试。

### Phase 1: LLM 语义理解

- 优先修改现有结构类型 skill 和 `opensees-seismic` stage 文档，让 LLM 输出抗震 intent。
- 只有当多个结构体系需要复用同一套抗震语义理解时，再新增 `general/china-seismic-design-intent` skill。
- 增加缺参追问和假设确认。

### Phase 2: 反应谱 MVP

- 重写 `opensees-seismic` 反应谱模块。
- 支持模态分析、CQC/SRSS、楼层响应和基底剪力。
- 报告规范版本和方法选择理由。

### Phase 3: 地震波与弹性时程

- 支持上传和本地波库引用。
- 支持人工模拟波。
- 实现调幅、平均谱、65%/80% 校核。
- 实现 3 组和 7 组规则。

### Phase 4: 规范校核和报告

- 升级 `code-check/gb50011`。
- 增加抗震报告模板。
- 增加中英文前端展示。

### Phase 5: 非线性和性能化

- 接入 `opensees-nonlinear`。
- 支持 Pushover 和弹塑性时程。
- 扩展性能化目标和罕遇地震变形验算。

## 18. 风险和待确认问题

- 规范条文和表格参数需要建立可审计的数据来源，不能只写在代码常量里。
- 城市到 `GB 18306-2015` 参数的映射需要合法数据源。
- 不同结构体系的规则性判断需要逐步实现，第一阶段可要求用户或模型显式提供。
- OpenSees 反应谱分析在不同模型维度、质量定义和刚性楼板处理上需要明确约束。
- 地震波库授权和用户上传数据保留策略需要产品和安全侧确认。
- 弹塑性分析需要材料本构、构件铰、收敛策略和结果解释，不能在 MVP 中简单包装为“已支持”。

## 19. 验收标准

第一阶段可交付版本应满足：

- 用户用自然语言提出中国抗震分析需求，系统通过 LLM 产生结构化 intent。
- 系统不通过关键词或正则判断分析方法。
- 常规框架可完成反应谱分析并输出规范版本、方法理由、模态和楼层响应。
- 对触发时程的结构，系统能说明需要地震波，并在缺少波形时追问或阻塞。
- 上传或提供 3 组/7 组地震波后，系统能执行弹性时程、做 65%/80% 校核并输出组合结果。
- 中文和英文报告均可显示设计依据、假设、方法选择、结果和限制。

## 20. 当前代码对齐后的最小改动方案

结合当前实现，第一轮修改应控制在现有模块边界内，避免引入新的顶层流程。

### 20.1 保持不变的边界

- 不新增新的顶层 agent 模式，也不改静力、动力、PKPM、YJK、既有 OpenSees 静力流程。
- 继续使用 `backend/src/agent-skills/analysis/opensees-seismic` 作为中国抗震分析入口，保持 `analysisType: seismic`。
- `analysisType="seismic"` 时不使用 `backend/src/agent-langgraph/tools.ts` 里既有的服务商请求正则；抗震分析 provider 来自结构化 skillScope。中国抗震的方法选择必须来自 LLM 结构化理解和结构化字段上的确定性规则。
- 不把反应谱和时程拆成两个 analysis skill，避免和现有 registry 的 `analysisType + engineId` 解析产生歧义。

### 20.2 数据契约

- 优先复用 `DraftState.siteSeismic`、`DraftState.analysisControl.designParams` 和 `DraftState.skillState`。
- 新增逻辑契约 `skillState.seismicWorkflow`，用于保存 LLM 理解后的抗震设计意图、规范依据、方法偏好、缺失项、地震波需求和用户确认状态。
- `run_analysis` 工具只增加一个最小可选字段 `seismicWorkflowJson?: string`。工具层只做 JSON 解析和 schema 校验，然后把结果传入 `parameters.seismicWorkflow`，不在 TypeScript 层通过自然语言做方法推断。
- `opensees-seismic` 继续兼容旧参数，例如 `{ method: "response_spectrum" }`，但需要在结果中标记为兼容路径，不能声称完成完整中国规范流程。

### 20.3 LLM 语义理解

- 第一阶段优先更新 `structure-type/concrete-frame/draft.md` 和 `analysis/opensees-seismic` 的 stage 文档，让 LLM 输出 `skillState.seismicWorkflow`。
- TypeScript 侧只负责 schema 校验、缺参列表和状态合并，不负责从用户文本提取关键词。
- 如果后续钢框架、剪力墙、桥梁等结构都需要同一套抗震 intent，再把该能力抽为 `general/china-seismic-design-intent` skill。

### 20.4 OpenSees 模块划分

`opensees-seismic/runtime.py` 应保持为薄调度层，新增逻辑放在同目录下的小模块中：

- `seismic_contracts.py`：解析和校验 `parameters.seismicWorkflow`。
- `design_basis.py`：归一化 `GB 55002-2021`、`GB/T 50011-2010(2024年版)` 和 `GB 18306-2015` 所需参数。
- `method_decision.py`：只基于结构化字段选择反应谱、补充弹性时程或阻塞追问。
- `spectrum.py`：生成设计反应谱和阻尼调整。
- `modal.py` 或 `opensees_model.py`：基于真实 OpenSees 模型提取周期、振型和质量参与。
- `ground_motion.py`：地震波记录、单位、调幅、平均谱和 65%/80% 校核。
- `result_adapter.py`：统一输出为现有 `AnalysisResult` 形状，并保留 `data.envelope` 兼容后处理和报告。

现有简化模块中的固定周期、固定质量和固定振型只能作为过渡兼容逻辑，不能作为中国抗震 MVP 的正式结果。

### 20.5 首个可交付闭环范围

- 第一轮只承诺混凝土框架路径，因为当前 `concrete-frame/model.ts` 已经能把 `site_seismic` 和 `analysis_control` 写入模型元数据。
- 反应谱先交付：真实模态、楼层响应、基底剪力、层间位移角和方法选择理由。
- 时程分析第二步交付：先支持用户提供的 3 组或 7 组波，完成调幅、谱一致性和组合规则。
- 对尚未支持的结构体系返回明确的 `partial` 状态、缺失能力和下一步要求；执行失败仍按现有分析运行时约定抛出异常。

### 20.6 测试边界

- 增加工具契约测试：`seismicWorkflowJson` 能透传到 `parameters.seismicWorkflow`。
- 增加方法选择单元测试：输入结构化对象，验证反应谱/时程/追问选择，不测试关键词命中。
- 增加 `opensees-seismic` 兼容测试：旧 `method` 参数仍能运行或返回清晰兼容提示。
- 增加回归保护：静力分析、现有动态分析、PKPM/YJK skill 不受影响。

## 21. 当前实现状态

本分支已经完成第一条可执行主线：

- `param-extractor` 与 runtime skill executor 的输出合同已显式包含 `skillState.seismicWorkflow`，并要求中国抗震方法和地震波需求来自整句语义理解后的结构化字段；抽取器会保留既有 `skillState.seismicWorkflow`，不会把历史无效字段诊断混入下一轮澄清。
- Param-extractor、runtime skill executor、泛型 StructureModel builder prompt 和 GB50011 code-check skill 提示现在也要求用户文本、模型 JSON 或上传表格中的构件抗震校核证据必须保留为结构化字段：`seismicCapacity`、`capacityDesign`、`strongShearWeakBending`、`shearCompression`、`jointCore`、`wallData`、`boundaryElement`、`steelSeismicDetailing` 都是显式合同字段。这样构件承载力和构造证据会进入确定性 code-check，而不是停留在自然语言备注；prompt 测试会断言这些字段持续存在于 LLM 合同中，并要求 LLM 不判断条文通过或失败。
- 确定性 StructureModel 构建现在会在模型生成后保留结构化 `seismicMemberEvidence` / `seismicWorkflow.memberEvidence`：带有明确匹配 element ID 的证据会用同一套 GB50011 code-check 键附着到对应构件，无法匹配的证据会保留在模型 metadata 中作为审计信息，不会猜测挂到某个构件上。
- 分析 provider 选择同样不使用自然语言关键词或正则路由。若用户语义上指定 PKPM/SATWE、YJK 或 OpenSees，LLM 必须把对应 provider 作为结构化 `analysisSkillId` 传给 `run_analysis`；工具只检查该 skill 是否已在当前会话选择，未选择时返回 `ANALYSIS_PROVIDER_NOT_SELECTED`。
- 计算层同时接受语义合同字段和规范化 runtime 字段：`requestedMethod.preference`/`methodPreference`、`structureProfile`/`structure`、`groundMotionRequirement.recordCount/directions`/`groundMotionSet.requiredCount` 都会进入确定性方法选择和设计依据归一化，避免 LLM 按设计合同输出时被漏读。
- `set_session_config` 在会话被设置为 `analysisType="seismic"`、GB50011/GB55002 设计规范或 `opensees-seismic` skill 时，会自动补齐中国抗震安全基线 skill：通用/框架/混凝土框架建模、OpenSees 抗震分析、GB50011 code-check、结构模型校验和报告导出，避免只选分析 provider 后切断建模或校核链路。
- `run_analysis` 支持 `seismicWorkflowJson`，并能从 `draftState.skillState.seismicWorkflow` 读取 LLM 结构化抗震 intent；LangGraph 对话工具层在 `analysisType="seismic"` 且没有非空 `seismicWorkflow` 时返回 `SEISMIC_WORKFLOW_REQUIRED`，不会直接进入兼容计算路径；对方法枚举、方向、振型组合、地震波记录数组、地震波需求条数、目录 ID 和调幅上限做轻量结构校验。底层 `opensees-seismic` runtime 会把结构化调用标记为 `workflowInputMode="structured_seismic_workflow"`，把旧参数直接调用标记为 `workflowInputMode="legacy_compatibility_parameters"` 并附带警告。同一模式会出现在精简工具摘要、报告抗震专项和前端分析概览中。
- 旧的 `AgentPolicyService` 仍保留非抗震兼容辅助逻辑，但不再通过自然语言正则匹配推断 `GB50011` 或 `GB55002`；中国抗震规范选择必须来自 LLM 生成的结构化 `seismicWorkflow` 或显式 session config，避免 regex policy helper 绕过语义路由。
- `opensees-seismic/runtime.py` 已拆为契约解析、设计依据、方法决策、设计谱、模态、地震波和结果适配模块。
- 反应谱路径支持 OpenSees 模态提取、设计谱、CQC/SRSS 振型组合、楼层响应、基底剪力、层间位移角、用于 GB/T 50011 5.2.5 的楼层剪重比和楼层最小剪力调整追踪，以及现有 `envelope` 后处理契约；默认使用 CQC，可通过结构化 `responseSpectrum.modalCombination="srss"` 切换；3D 模型可按结构化 `directions=["x","y"]` 执行双向分析，并在 `directionResults` 与总体包络中保留控制方向。对已实现 GB/T 50011 5.5.1 位移角限值的结构族，反应谱结果现在会输出 `responseSpectrum.finalCompliance` / `responseSpectrumFinalCompliance`，完整弹性反应谱/时程总包络会输出带 `limitFamily` 和 `limitRatioText` 的 `elasticStoryDriftFinalCompliance`：混凝土框架 `1/550`、混凝土框架-抗震墙/框架-核心筒 `1/800`、混凝土抗震墙/筒中筒/转换层结构族 `1/1000`、钢框架/钢结构 `1/250`。每个方向会先按 5.2.5 对不足的反应谱楼层水平力进行放大，再转为 OpenSees 等效水平静力工况，输出 `seismicDesignActions.memberForces`，用于后续构件设计作用和 code-check 追踪。
- OpenSees 抗震建模现在会把结构化两节点墙单元作为等效杆单元纳入模态、反应谱等效水平静力、重力代表值静力和竖向地震静力路径。当前范围是明确受限的：支持 `type="wall"` 及兼容的结构化墙类型别名，读取 `section.thickness` 和显式 `section.properties.wallLength` 或由面积反推墙长；不等同于壳单元墙网格、带洞口墙有限元或完整非线性墙本构。
- 地震波路径支持用户提供的记录、上传文件经 `analyze_file` 解析后的 CSV `headers/rows`、AT2/TXT `content`、单位转换、第一振型调幅和谱匹配摘要、多振型 modal SDOF 响应统计、CQC/SRSS 振型组合、可由 `groundMotionSet.scaleFactorLimit` 配置的调幅控制、3 组/7 组组合逻辑和 65%/80% 基底剪力校核；现在会输出 `timeHistory.combinationSummary`：3 组波取时程包络基底剪力与反应谱基底剪力较大值，7 组及以上取时程平均基底剪力与反应谱基底剪力较大值。时程分支会尝试执行 OpenSees transient 附加检查，在可用时优先按上下楼层匹配的竖向节点线提取最大 transient 层间位移角，无法匹配节点线时才回退楼层平均位移角，并把时程位移角纳入总包络；不可用时明确保留 modal SDOF fallback。
- 结构化 `methodPreference="elastic_plastic_time_history"` 已被显式识别，不再被归入 `auto`；在 `auto` 下，结构化罕遇地震设计水准、性能目标、显式弹塑性变形验算需求或结构化非线性模型/时程控制现在会确定性触发弹塑性时程需求。运行时会执行可用的反应谱和弹性时程对照。当结构化 `nonlinearModel.memberPlasticHinges` 为 2D 构件端提供完整屈服弯矩/屈服转角数据时，弹塑性分支会优先执行受限的 OpenSees 构件端转动塑性铰 transient 估算，输出 `modelScope="member_end_rotational_plastic_hinges_2d"`、记录级塑性铰响应和控制塑性铰；该路径不可用时，在楼层质量可用时执行 OpenSees bilinear 多楼层剪切楼弹塑性估算，单层模型或多楼层求解失败时回退到 bilinear SDOF 估算。没有结构化屈服位移角时，这些 reduced-model fallback 会使用共享的结构族 GB/T 50011 5.5.1 弹性位移角限值作为建议屈服位移角，并输出 `yieldDriftLimitRatioText` / `yieldDriftLimitFamily`；未覆盖结构族会保留显式混凝土框架 fallback 标记。结果会输出 `elasticPlasticTimeHistory` 记录级屋面位移、基底剪力、延性、可用时的楼层层间位移角追踪，并基于最大层间位移角和验收限值生成 `elasticPlasticTimeHistory.finalCompliance`；同时会把结构化 `nonlinearModel.materialConstitutiveModels`、`nonlinearModel.memberPlasticHinges`、塑性铰骨架标定和 `convergenceCriteria` 审计到 `elasticPlasticTimeHistory.nonlinearModelAudit`，把缺失模型输入与求解器能力边界分开追踪。由于尚未建立完整分布塑性/全构件非线性本构求解器，即使受限 2D 塑性铰路径已运行，结果仍会通过 `scope` 和 `missingCapabilities` 中的 `gb50011.elasticPlasticTimeHistoryFullMemberAnalysis` 明确剩余全构件能力边界。
- 结构化性能目标现在可以通过 `performanceObjective.acceptanceDriftRatio` / `limitDriftRatio`，或方法专属的 `elasticPlasticTimeHistory.performanceObjective`、`pushover.performanceObjective` 提供漂移验收目标；该目标会写入弹塑性时程和 Pushover 的验收检查、最终符合性对象、报告和前端概览。在 `methodPreference="auto"` 下，结构化性能目标也会参与确定性方法选择：有地震波时要求弹塑性时程路径，没有地震波但存在结构化 Pushover 输入时选择 Pushover 路径，两类非线性执行输入都缺失时才输出缺失地震波输入。这是结构化验收目标和受限容量谱性能点估算能力，不等同于完整性能化设计流程。
- 独立的 `analysis/opensees-nonlinear` runtime 不再直接抛出 `NotImplementedError`；现在会返回结构化 `partial` 能力边界结果，包含模型规模、非线性模型输入审计、缺失输入、缺失的全构件求解器能力和下一步动作。这样显式非线性请求可以被解释清楚，但不会冒充已经具备完整 OpenSees 非线性执行能力。
- 3D 时程中地震波记录可带结构化 `direction`/`component` 字段；runtime 会按 X/Y 方向选用匹配分量，未标注方向的记录仍作为通用记录用于每个请求方向，不会用 Y 分量冒充 X 分量。
- 当结构化要求触发补充时程但地震波缺失或数量不足时，结果输出 `groundMotionRequirement`，包含 required/provided/missing 数量和状态；双向时程会额外输出 `totalRequiredCount` 与 `directionRequirements`，逐方向统计 X/Y 分量是否缺失，顶层 `missingInputs` 保留 `groundMotions`，报告和前端概览会显示完整地震波需求和缺波方向。
- Pushover 路径已从旧兼容返回升级为中国抗震 workflow 统一结果：复用 OpenSees 弹性框架模型执行线性静力位移控制 Pushover，输出 `data.pushover`、`envelope`、`methodDecision`、`designBasis` 和报告指标；当前已从曲线中生成初始刚度、基于 GB 设计谱和楼层重量的 secant 容量谱性能点估算、位移角和建议限值验算。当结构化 `nonlinearModel.memberPlasticHinges` 为 2D 框架提供完整的构件端屈服弯矩和屈服转角时，会优先执行受限的 OpenSees 构件端转动塑性铰位移控制估算，输出 `modelScope="member_end_rotational_plastic_hinges_2d"`、塑性铰响应和控制塑性铰；该路径不可用时，再在楼层质量可用时追加 OpenSees bilinear 多楼层剪切楼估算，单层模型或多楼层求解失败时回退到 bilinear SDOF 估算。Pushover reduced-model fallback 在没有显式屈服位移角时，会复用弹塑性时程的结构族建议屈服位移角元数据。运行时会基于弹塑性估算或容量曲线验算生成 `pushover.finalCompliance`，在对应路径运行时标记 `pushoverPerformancePointEstimate`、`pushoverCapacitySpectrumIteration`、`pushoverMemberPlasticHinge2dEstimate`、`pushoverBilinearSdofEstimate`、`pushoverBilinearStoryShearBuildingEstimate` 和 `gb50011.nonlinearPushoverFinalCompliance`；若其他输入或规则性预分析 warning 存在，整体状态仍可为 `partial`，且 2D 塑性铰路径仍会暴露剩余全构件本构能力边界。
- 内置 `SCGM-A1` 至 `SCGM-A7` 人工波目录已支持结构化选波和自动选波；它只用于 workflow、演示和回归，不作为真实强震记录库。
- 支持用户或项目提供的本地/授权地震波目录 `groundMotionSet.localCatalog.records`，可按结构化 `catalogIds` 精确选波，也可按 `selectionCriteria` 中的记录类型、场地类别、震级范围、距离范围和目标震级/距离确定性筛选排序；选中记录保留 `recordType=actual`，用于时程分析和实际强震记录比例校核。
- 方法选择只基于 `seismicWorkflow`、模型元数据、自动规则性判别和规范结构化字段，不使用关键词或正则方法判断。自动选择现在覆盖反应谱、补充弹性时程、由结构化罕遇地震/性能目标/非线性模型需求触发的弹塑性时程，以及在缺少地震波但存在结构化非线性静力输入时选择 Pushover。
- `seismicWorkflow.structure.heightM/storyCount` 已写入 `SeismicDesignBasis`，并优先于旧模型 metadata 参与自动方法选择；当结构化高度触发补充时程但地震波缺失时，运行结果返回 `partial`、`groundMotionRequirement` 和 `missingInputs=["groundMotions"]`，不会静默降级为纯反应谱最终结果。
- `opensees-seismic/regularity.py` 已提供模型结构化启发式规则性判别，读取显式嵌套 `seismicWorkflow.regularityAssessment.classification`、楼层高度、楼面荷载、结构化楼层质量/重量或楼面荷载乘楼层平面面积推导的楼层质量突变、结构化全局或楼层级楼板开洞面积/开洞率与刚性楼板标志、结构化楼层侧向刚度、楼层柱侧向刚度、结构化楼层抗侧承载力/剪力容量突变、结构化薄弱层/软弱层标志、楼层平面收进、结构化平面不规则/凹角/平面凹入标志或比例、结构化转换层/竖向抗侧力体系不连续标志、整体平面长宽比、结构化扭转位移比、节点平面范围和楼层节点形心/柱刚心偏心；判为 `particularly_irregular` 时会触发补充时程需求，判为 `irregular` 时只提示工程师复核。
- 设计依据结果已输出 `region`、`seismicGrade`、`missingInputs` 和 `isPreliminary`；如果只有地区但没有正式 `GB 18306-2015` 设防烈度或设计基本地震加速度，结果和报告会标记为预分析，不宣称最终规范通过；若只提供 7 度或 8 度烈度而没有设计基本地震加速度或显式 `alphaMax`，运行结果会标记缺少 `designBasis.siteSeismic.accelerationG`，并采用对应高档保守 `alphaMax` 进行预分析。`codeBasis` 同时记录 `GB 18306-2015` 及 2026-02-27 起实施的第1号修改单是当前正式地震动参数区划标准依据，并携带官方 `20260055-Q-419` 起草阶段完整修订计划追踪；报告会显示该修订计划未作为当前正式设计依据。
- 设计基本地震加速度解析已支持语义合同字段 `designBasicAccelerationG` 以及兼容字段 `accelerationG`/`basicAccelerationG`；0.15g、0.30g 等高档输入会正确推导烈度和 `alphaMax`，不会误判为缺失。
- 设计依据归一化现在会按 `GB 50223-2008` 将结构化 `fortificationCategory` 归一化为特殊/重点/标准/适度设防类别，输出中英文类别标签、A/B/C/D 分类、地震作用标准、抗震措施标准和抗震措施烈度；特殊设防类在没有结构化、已批准的地震安全性评价时会标记为预分析。对于特殊设防类，安评对象提供的 `designBasicAccelerationG`、`intensity`、`designGroup`、`characteristicPeriod`、`rareCharacteristicPeriod` 和 `alphaMax` 只有在 `seismicSafetyEvaluation.approved` 明确为 true 时才会作为结构化设计依据优先于地方参数。
- 设计依据已支持结构化 `earthquakeLevel`/`targetEarthquakeLevel`，将多遇、设防、罕遇三档映射到对应水平地震影响系数最大值；罕遇地震会按 `GB/T 50011-2010（2024年版）` 的反应谱规则将特征周期增加 0.05s。罕遇地震纯弹性反应谱结果会保留数值谱和包络，同时输出 `gb50011.rareEarthquakeElasticPlasticDeformation` 能力边界；若同一运行已完成弹塑性时程或 Pushover `finalCompliance`，则该能力计入 `implementedCapabilities`，不再把大震弹塑性变形验算误报为缺失。
- 反应谱结果现在输出 `periodRangeAssessment`；若任一模态周期超过 GB/T 50011 常规设计谱 6.0s 范围，运行还会输出 `longPeriodSpecialStudyAdvisory`，包含控制振型和保守建议地震影响系数追踪。结果仍会暴露 `gb50011.responseSpectrumLongPeriodSpecialStudy`，将最终符合性标记为不支持，并在报告和前端概览显示长周期专项研究要求，因为该 advisory 不能替代项目专项长周期研究。
- 方法决策已支持结构化竖向地震作用需求判定：8、9 度且 `structureProfile.hasLargeSpan`、`hasLongCantilever`、`hasIsolation`，或 9 度高层条件触发时，会在 `methodDecision.verticalSeismicRequired` 中输出原因。大跨/长悬臂路径会计算竖向地震作用标准值、系数、代表重力荷载和楼层分配，并尝试用 OpenSees 对等效竖向荷载做静力求解，输出竖向基底反力、最大竖向位移和构件端力；大跨度空间结构可按 `0.65 * alphaMax` 的等效竖向反应谱系数计算。`GB50011` 全局校核会读取构件端力，并在存在显式结构化 `verticalSeismicCapacity` 利用率或需求/承载力数据时优先采用；否则回退到 `elementData` 的截面/材料做简化竖向地震构件承载力抽查。若两类可比较数据均不足，会返回不可适用项而不是默认通过。
- 方法决策现在也暴露结构化隔震和消能减震审计及能力边界。当输入包含 `structure.hasIsolation`、`structureProfile.hasIsolation`、`structure.hasEnergyDissipation`、`structure.hasEnergyDissipationSystem`、`structure.hasDampingDevice`，或专门的 `isolationSystem` / `energyDissipationSystem` / `dampingSystem` 对象时，结果会记录 `methodDecision.specialSystemReviewRequired`、保留具体触发原因，输出 `specialSystemReview`，其中包含体系类型、设备数量、缺失的结构化设备/输入字段，以及已提供需求/容量时的验收检查；GB50011 code-check 现在会在专门体系审计项中保留这些验收检查明细，包括项目、状态、利用率、公式、需求、容量、来源和单位；当隔震刚度、阻尼、位移容量以及模态质量或显式体系质量/重量可用时，还会输出受限的隔震等效线性反应谱估算，包括周期、地震影响系数、基底剪力、位移需求和位移利用率；当地震波记录也可用时，现在会追加受限的隔震层 SDOF 时程估算，输出逐记录位移/基底剪力响应、控制波、位移利用率和最终符合性追踪；当消能减震体系提供显式附加/等效阻尼比以及变形需求/容量输入时，还会输出受限的等效阻尼变形估算，包括周期、阻尼比、需求折减系数、调整后变形需求和变形利用率；当消能减震体系具备质量、周期/刚度、阻尼、设备和已选地震波时，还会输出受限的消能器 SDOF 时程估算，包括逐波设备变形/设备力需求、控制波、利用率和最终符合性追踪。结果仍会把 `gb50011.isolationSystemSpecialSeismicAnalysis` 和/或 `gb50011.energyDissipationSystemSpecialSeismicAnalysis` 写入 `missingCapabilities`，并将最终符合性标记为不支持，避免把普通反应谱/时程结果误认为完整的专门体系设计。
- GB50011 整体校核现在也会读取结构化超限或专项抗震审查追踪，包括 `analysisSummary.overLimitReview`、`analysisSummary.specialReview`、`analysisSummary.specialSeismicReview`、`analysisSummary.overLimitSpecialReview`，以及嵌套在 `designBasis` / `methodDecision` 中的对应审查对象和 `regularityAssessment` 中的显式审查标志。若结构化字段表明需要审查，在审查追踪提供已批准或已完成证据前，最终符合性会失败；已批准审查证据会保留来源路径、类型、审查机构、日期和批准/报告编号。这只是可审计的证据闸口，不从用户消息关键词推断法定超限状态，也不替代正式专项审查流程。
- 运行时会基于楼层质量提取重力代表值下的 OpenSees 构件端力，并把水平地震等效静力、竖向地震作用和重力代表值组合为 `memberDesignActionCombinations`。当前覆盖基本抗震作用组合工况：单方向保留 `1.2G + 1.3Eh`，双向反应谱会输出 `1.2G + 1.3Ex`、`1.2G + 1.3Ey` 以及按 `designCombinations.orthogonalHorizontalFactor` 控制的 X/Y 伴随方向组合；需要竖向地震时还输出 `1.2G + 1.3Ev` 及水平/竖向伴随组合。组合结果按构件输出轴力、剪力和弯矩绝对值包络，用于报告、前端概览和 GB50011 全局校核追踪。
- 支持用户或项目提供的结构化 `GB 18306-2015` 区划参数表，按 `regionCode` 或精确 `region` 匹配后填充设计基本地震加速度、设防烈度、设计地震分组和特征周期；系统不内置或猜测城市参数。
- `GB 50011` code-check 入口已接受 `GB/T 50011-2010-2024` 和 `GB 55002 + GB/T 50011` 等别名，并对抗震分析结果追加 `__global_seismic__` 整体校核：抗震设计依据完整性、结构化抗震等级依据、结构化 workflow 输入、能力边界、隔震/消能减震专门体系结构化审计（存在时会携带受限隔震层和消能器 SDOF 时程估算证据）、规则性评估与特别不规则补充时程触发、多遇地震弹性层间位移角、振型参与质量系数、反应谱长周期专项研究要求、GB/T 50011 5.2.5 楼层最小地震剪力系数、水平地震构件内力、抗震基本作用组合、组合构件承载力抽查、必需补充时程完整性、地震波 3 组或不少于 7 组规则、时程基底剪力 65%/80% 比例、时程组合摘要规则、双向时程方向级追踪、实际强震记录比例、地震波调幅系数、弹塑性时程最终符合性、Pushover 弹塑性估算位移角和 Pushover 最终符合性。工具桥接现在会把弹塑性时程、规则性评估、水平/重力构件内力和抗震基本作用组合透传给 code-check；普通构件校核在具备构件组合内力和显式承载力或利用率时，会追加结构化抗震组合构件承载力校核；当这类结构化承载力数据同时给出显式 `gammaRE` / `seismicCapacityAdjustmentFactor` 时，会按 `S <= R/gammaRE` 追踪调整后承载力、利用率和调整系数来源；对混凝土梁、柱、抗震墙和连梁，在具备结构化剪力需求、混凝土强度、截面宽度和有效高度，或显式利用率数据时，会追加 GB/T 50011 6.2.9 剪压比限值校核；对混凝土框架梁柱，在具备结构化能力设计剪力需求/承载力或利用率数据时，会追加 GB/T 50011 6.2.4 + 6.2.5 强剪弱弯受剪承载力校核；在具备结构化 `seismicGrade`、组合轴力、截面面积和混凝土强度时，会追加 GB/T 50011 6.3.6 框架柱轴压比限值验算；在具备结构化柱 `shearSpanRatio` 时，短柱轴压比限值会降低 0.05，剪跨比小于 1.5 时会输出专项研究/特殊构造失败项；在具备混凝土材料等级或显式 `fc` 时，会追加 GB 55002-2021 5.1.2 框支梁/柱及一、二级框架梁柱混凝土强度等级不低于 C30 的校核；在具备梁截面宽高和构件跨度时，会追加 GB/T 50011 6.3.1 框架梁截面宽度、高宽比和净跨高比校核；在具备结构化梁截面/钢筋/节点数据时，会追加 GB/T 50011 6.3.2/6.3.3/6.3.4 框架扁梁构造、梁顶/底贯通纵筋数量、直径、一二级贯通面积比例、梁端受压区相对高度、梁端底/顶纵筋面积比、梁端受拉配筋率上限、贯通中柱纵筋直径限值、梁端箍筋加密区长度、箍筋间距/直径、肢距、首道箍筋距离和 135 度弯钩构造校核；在具备结构化柱或节点钢筋/承载力数据时，会追加 GB/T 50011 6.2.2、6.2.15 + 附录 D 以及 6.3.7/6.3.8/6.3.9/6.3.10 框架节点强柱弱梁弯矩关系、框架节点核芯区截面抗震验算、框架柱纵筋最小配筋率、纵筋补充构造、箍筋加密区直径/间距、箍筋加密区范围、箍筋体积配箍率、非加密区箍筋体积/间距和框架节点核芯区箍筋构造校核。
- `GB50011` 整体校核现在增加 `GB 18306-2015` 标准状态校核项、`GB 55002-2021 2.3.2 + GB 50223-2008` 设防类别校核项和结构化抗震等级依据项；这些项只读取结构化设计依据字段，确认当前 `GB 18306-2015` 及已实施第1号修改单仍为正式区划依据、草案修订计划仅作为追踪信息，确认设防分类、地震作用标准、抗震措施标准和措施烈度追踪完整，校核特殊/重点/标准设防类的措施烈度一致性，确认已提供的 `seismicGrade` 属于 1-4 级并在可用时携带结构化来源路径，并在特殊设防类缺少所需结构化地震安全性评价时判为失败。
- 当构件被结构化为混凝土抗震墙时，构件校核会追加 GB/T 50011 6.4 墙肢轴压比、墙厚、分布钢筋构造和边缘构件构造项。墙体校核覆盖结构化轴压比或组合轴力按项目/规范推导限值验算、按抗震等级/层高控制墙厚、底部加强部位墙厚、双排分布筋、拉筋间距/直径、竖向和横向分布钢筋配筋率、间距和直径；当结构化边缘构件数据同时提供实际值和规范/项目推导限值时，还会校核边缘构件纵筋配筋率/直径以及箍筋或拉筋间距、直径和体积配箍率。若声明必须设置边缘构件但缺少可比较的结构化数据，会返回 `not_applicable`，不会默认通过。该能力只读取 `type="wall"`/`type="shear-wall"`、`section.thickness`、`storyHeightMm`、`reinforcement.wall`、`boundaryElement`/`edgeMember`、`shearWallData` 等结构化字段；工具桥接现在会把这些字段保存在 `elementData` 和 `elementContextById` 中。
- 当构件被结构化为钢梁、钢柱、支撑或连梁/耗能梁时，构件校核现在会追加 GB/T 50011 第 8 章结构化钢构件抗震构造限值项。该项只读取结构化 `steelSeismicDetailing`、`steelDetailing` 或 `seismicDetailing` 记录，将构件/支撑长细比以及翼缘、腹板或板件宽厚比实际值与同一结构化数据中提供的项目/规范推导限值比较；若只有实际值而缺少可比较限值，会返回 `not_applicable`，不会把钢构件默认判为符合。Code-check 桥接会把模型构件、metadata、element extra、截面、section extra 或 section properties 中的这些记录保留到 `elementData` / `elementContextById`。
- Code-check 桥接现在也会把模型构件、metadata、element extra、截面、section extra 或 section properties 中的结构化 GB50011 构件证据保留到 `elementData` / `elementContextById`，包括 `seismicCapacity`、`capacityDesign`、`strongShearWeakBending`、`shearCompression`、`jointCore`、`jointData`、`flatBeam`、`columnPosition` 和 `columnCategory`。这样混凝土构件承载力/构造校核可以从普通模型 JSON 链路触发，而不只依赖手写 Python code-check context。
- GB50011 code-check 输入和专用 GB50011 入口现在会携带结构化 `context.codeBasis`、`context.displayCode` 和 `context.codeVersion` 元信息，使后续审计和报告链路能保留准确的 `GB 55002-2021 + GB/T 50011-2010（2024年局部修订）` 依据，同时继续保留旧 `GB50011` 兼容 code。
- 抗震报告闸口现在要求分析结果显式标记为 `workflowInputMode="structured_seismic_workflow"`，并要求完成未跳过且包含 `__global_seismic__` / `global-seismic` 明细的 `code-check-gb50011`，不再接受任意 `codeCheckResult`；`run_analysis` 会写入 `meta.traceId`，`run_code_check` 写入图状态时会在 `meta.codeCheckSkillId` 中记录实际校核 skill、在 `meta.analysisTraceId` 中记录被校核分析 trace，`generate_report` 据此阻止旧参数兼容或未标记的分析结果、来自另一轮分析的旧校核、GB50017 校核、skipped 结果或只有普通构件校核的 GB50011 结果生成中国抗震计算书。
- 默认报告已增加规范校核摘要，会在条文追溯前显示总数/通过/失败/警告数量、存在或可从明细推导时的不适用/资料不足数量、可用时的控制校核信息，以及前若干个失败、不可适用或需关注项。抗震专项章节会显示地区、规范依据、已提供 GB18306 区划来源/地区码、模型规模、分析方向、振型组合、设计基本地震加速度、地震水准、抗震等级及来源、αmax、方法选择、方法选择理由、反应谱弹性层间位移角最终符合性、弹性总包络层间位移角最终符合性、长周期专项研究要求和 advisory 追踪、触发时的竖向地震原因、存在隔震/消能减震结构化输入时的专门体系复核原因、审计摘要、受限隔震等效线性估算指标、受限隔震层 SDOF 时程估算指标、受限消能减震等效阻尼估算指标和受限消能器 SDOF 时程估算指标、水平地震构件内力数量、抗震基本作用组合工况数、可用时的弹性时程控制楼层、组合摘要和方向级时程摘要、弹塑性时程状态/模型范围/楼层数/建议屈服位移角来源/非线性模型审计/控制楼层/控制塑性铰/最大漂移/最终符合性、Pushover 弹塑性估算/模型范围/楼层数/建议屈服位移角来源/控制楼层/控制塑性铰/最终符合性、地震波目录、完整地震波需求、地震波最大调幅系数、模态周期点地震波谱适配、预分析状态、基底剪力、层间位移角、模态质量参与、最小楼层剪重比和楼层最小剪力调整状态/系数；条文追溯会显示具体校核项名称。
- 前端分析概览已显示包含不适用/资料不足数量的规范校核摘要、控制校核和失败/不可适用/警告等需关注项，同时显示节点/单元/楼层数、抗震方法、方法选择理由、分析方向、振型组合、地区、已提供 GB18306 区划来源/地区码和现行标准/修订计划状态、设防烈度、地震水准、抗震等级及来源、场地类别、预分析状态、缺失输入、能力边界、专门体系复核原因、结构化专门体系审计的体系类型/缺失输入/检查数量、受限隔震等效线性估算周期/位移/状态、受限隔震层 SDOF 时程估算位移/状态、受限消能减震等效阻尼估算周期/调整后变形/状态、受限消能器 SDOF 时程估算变形/力/状态、长周期专项研究要求和 advisory 追踪、反应谱弹性位移角符合性及利用率、弹性总包络位移角符合性及利用率、规则性判别、水平/竖向地震构件内力指标、存在时的竖向地震触发原因、抗震基本作用组合工况数、可用时的弹性时程控制楼层、弹塑性时程状态/模型范围/楼层数/建议屈服位移角来源/非线性模型审计/控制楼层/控制塑性铰/最大漂移/最终符合性及利用率、Pushover 弹塑性估算位移角/模型范围/楼层数/建议屈服位移角来源/控制楼层/控制塑性铰/最终符合性及利用率、最大基底剪力、最大层间位移角、模态质量参与、最小楼层剪重比、楼层最小剪力调整状态/系数、地震波数量、完整地震波需求、缺波方向、最大调幅系数、模态周期点谱适配、时程基底剪力、时程组合摘要和方向级时程摘要。
- 默认报告和前端分析概览现在也会在存在 `overLimitReview`、`specialReview`、`specialSeismicReview` 或 `overLimitSpecialReview` 时展示结构化超限/专项审查追踪，显示审查需求状态、状态字段和批准/审查/报告编号。
- 默认报告和前端分析概览现在会展示设计依据中的结构化设防类别标签/分类、抗震措施烈度、地震安全性评价状态、受限隔震等效线性估算指标、受限隔震层 SDOF 时程估算指标、受限消能减震等效阻尼估算指标和受限消能器 SDOF 时程估算指标。
- 结构化中国抗震 workflow 不再以专门的前端 Context-tab 表单实现。常规控制台路径只发送原始对话消息、附件、选择的模型和既有通用 context；抗震设计依据、方法选择、审查证据、构件证据和地震波意图必须来自 LLM/agent 语义流程，或来自已经显式提供 `seismicWorkflow` 的 API/工具调用方。
- 直接 Analysis API 任务现在对结构化中国抗震任务保持和 chat workflow 一致的默认校核闸口：当 `type="seismic"` 且包含非空 `parameters.seismicWorkflow` 时，`runAnalysis` 会在 OpenSees 分析后自动执行 GB50011 code-check，把结果持久化到 `results.codeCheck`，随后复用默认报告导出模板，把可读计算书持久化到 `results.report`（`summary`、`json`、`markdown`）；调用方可显式设置 `parameters.autoCodeCheck=false` 只跑分析。任务 schema 也会保留 `parameters.designCode`，自动校核默认使用 `GB/T 50011-2010-2024`；如果结构化中国抗震任务显式传入 `GB50017` 这类非 GB50011 兼容规范，direct API 现在会让任务失败，而不是用错误的 code-check provider 生成中国抗震报告。
- Chat API 仍接受供直接客户端和未来可插拔对话模块使用的结构化 `context.seismicWorkflow`。LangGraph 会把它写入独立的 `contextSeismicWorkflow` 通道，而不是覆盖 `draftState`，`run_analysis` 会将其与 `draftState.skillState.seismicWorkflow` 深度合并；Analysis API 也会保留 `parameters.seismicWorkflow`。内置人工波目录元数据接口仍可供直接客户端或通用记录选择模块使用，但控制台不再包含硬编码的“中国抗震流程”面板。
- 上传、本地目录和内置地震波仍作为后端结构化输入支持。当结构化 workflow 引用上传来源，或直接调用方提供 `uploadedAttachments` 时，后端会从普通聊天附件解析内容补充 records；校验会拒绝没有解析 records 的 `source="uploaded"`。区划表、地震安全性评价、构件证据以及超限/专项审查追踪都保持为结构化数据合同，不从消息关键词推断。
- 未来若扩展 UI，应做成通用、可复用的对话可插拔模块，例如挂在某轮对话上的 interaction-module schema 或记录/JSON picker，而不是在 Context tab 常驻一个领域专用界面并自动注入 `analysisType`、`designCode`、固定 skill 或 `seismicWorkflow`。
- 分析结果已输出 `capabilityAssessment` 与 `missingCapabilities`；当结构族的 GB50011 最终符合性校核尚未覆盖时，响应谱/时程结果仍保留，但状态标记为 `partial`，报告、前端概览、精简工具摘要和 GB50011 code-check 都会显示能力边界，其中 code-check 会把缺失能力和显式 `workflowInputMode="legacy_compatibility_parameters"` 的分析结果作为最终符合性失败项，避免把未实现的条文覆盖或旧参数兼容路径误报为完整规范通过。
- `analysis-regression` 已纳入反应谱、反应谱弹性层间位移角最终符合性、3D 双向反应谱、水平地震构件内力提取、重力代表值构件内力、抗震基本作用组合、3 组数组地震波、多振型时程响应字段及调幅摘要、模态周期点地震波谱适配追踪、性能目标自动选择弹塑性时程、没有地震波时基于结构化非线性静力输入自动选择 Pushover、带多楼层剪切楼层间位移角追踪和结构化 2D 构件端塑性铰 transient 输入的弹塑性时程最终符合性、罕遇地震弹塑性变形能力判定、隔震和消能减震结构化标志的专门体系审计、受限隔震等效线性估算、受限隔震层 SDOF 时程估算、受限消能减震等效阻尼估算、受限消能器 SDOF 时程估算和能力边界、长周期反应谱专项研究能力边界、内置人工波目录、自动和嵌套显式规则性判别、软弱层刚度规则性判别、结构化薄弱层/软弱层标志规则性判别、结构化楼层侧向刚度和楼层抗侧承载力突变规则性判别、楼层质量突变规则性判别、全局和楼层级楼板大开洞/楼板不连续规则性判别、平面扭转偏心和结构化扭转位移比规则性判别、平面收进和结构化平面不规则规则性判别、竖向抗侧力体系不连续规则性判别、平面长宽比规则性判别、Pushover（含结构化 2D 构件端塑性铰输入）、上传内容解析时程和 GB50011 抗震整体校核合同验证。

尚未完成的完整能力：

- 内置城市到 `GB 18306-2015` 地震动参数的合法数据源映射；当前只支持用户或项目提供的结构化区划表。
- 内置真实强震记录库管理、授权、长期工程归档和完整持久化目录浏览器；当前已支持通过普通附件、显式 API/工具输入以及未来通用可插拔记录选择器提供的用户或项目结构化本地/授权目录，不包含专门的前端抗震 workflow 表单。
- 完整法定超限/专项抗震审查流程，包括各地申报材料、正式专家审查结论和工程归档记录。当前实现只在项目显式提供结构化审查需求时作为最终符合性的证据闸口，并保留项目提供的已批准/已完成证据。
- 全结构体系、全条文级规则性自动判别；当前只实现显式嵌套结构化规则性分类，以及楼层高度、楼面荷载/楼层质量突变、全局或楼层级楼板开洞面积/开洞率/楼板不连续、结构化楼层侧向刚度、楼层柱侧向刚度、结构化楼层抗侧承载力/剪力容量突变、结构化薄弱层/软弱层标志、楼层平面收进、结构化平面不规则/凹角/平面凹入标志或比例、结构化转换层/竖向抗侧力体系不连续、整体平面长宽比、结构化扭转位移比、节点包络和平面扭转偏心的保守启发式判别。
- 真正的 OpenSees 分布塑性/全构件非线性弹塑性时程、通用 3D/全构件非线性 Pushover 和完整性能化目标流程；当前弹塑性时程和 Pushover 均已在 reduced-model fallback 前增加受限的结构化 2D 构件端转动塑性铰路径，Pushover 也已具备受限 secant 容量谱性能点迭代估算，但二者仍不是完整分布塑性/全构件非线性模型或完整性能化设计程序。
- 专门的隔震和消能减震体系分析，包括精细隔震支座/装置建模、完整隔震层有限元动力分析以及阻尼器变形/内力验收；当前实现会从显式 workflow 标志或专门体系对象输出结构化 `partial` 能力边界，并在提供设备、需求和容量时输出设备/输入审计、简单需求-容量验收追踪、受限隔震等效线性反应谱估算、地震波可用时的受限隔震层 SDOF 时程估算、受限消能减震等效阻尼变形估算，以及地震波和 SDOF 设备输入可用时的受限消能器 SDOF 时程估算，但尚不会运行专门的隔震或阻尼器有限元模型。
- 全构件设计承载力校核、构造细则和专项构件条文覆盖；当前已能输出竖向作用标准值、楼层分配、基于结构化反应谱楼层结果的楼层最小地震剪力系数校核、OpenSees 等效竖向静力检查、构件端力、支持显式结构化容量数据或截面/材料简化估算的竖向地震构件承载力校核，且在需求/承载力数据提供显式 gammaRE 时追踪抗震调整系数、重力代表值参与的基本抗震作用组合、有截面/材料数据时的组合构件承载力抽查、有显式承载力或利用率时的逐构件结构化抗震组合承载力校核、这类结构化承载力校核的显式 gammaRE 抗震调整系数追踪、有结构化剪力和有效截面数据时的混凝土构件剪压比限值校核、有结构化能力设计数据时的混凝土框架强剪弱弯受剪承载力校核、有 `seismicGrade` 和组合轴力时的框架柱轴压比限值验算、有柱剪跨比时的短柱轴压比限值折减和专项研究提示、有混凝土材料等级/强度时的框架梁柱最低 C30 材料等级验算、有截面宽高/跨度/钢筋数据时的框架梁截面几何、扁梁构造、贯通纵筋、梁端纵筋延性、贯通中柱纵筋直径和梁端箍筋加密区构造验算、有框架柱截面宽高、抗震等级和层数时的柱截面几何构造验算、有结构化柱钢筋数据时的柱纵筋配筋率、纵筋补充构造、箍筋直径/间距、箍筋加密区范围、箍筋体积配箍率和非加密区箍筋验算、有结构化节点弯矩/核芯区数据时的框架节点强柱弱梁弯矩关系、节点核芯区截面抗震验算和箍筋构造验算、有结构化钢构件实际值和规范/项目推导限值时的长细比及宽厚比抗震构造验算，以及有结构化墙体、组合轴力和边缘构件数据时的抗震墙轴压比、墙厚、分布钢筋和边缘构件构造验算。
