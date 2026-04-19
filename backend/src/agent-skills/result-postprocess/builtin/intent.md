# Intent / 意图

> Manifest-first note / 清单优先说明
>
> Canonical skill metadata for this builtin postprocess skill lives in `skill.yaml`.
> This file is content-only and no longer defines the skill id, stages, grants, or runtime metadata.
>
> 此内置后处理技能的 canonical 元数据以 `skill.yaml` 为准。
> 当前文件仅承载内容，不再定义技能 id、阶段、授权工具或运行时元数据。

## Purpose / 目的
- `zh`: 对分析原始结果执行包络提取、关键指标汇总和控制工况筛选，输出结构化的后处理数据供下游消费。
- `en`: Extract envelopes, summarize key metrics, and filter controlling cases from raw analysis results into structured postprocessed data for downstream consumers.

## Postprocessing Scope / 后处理范围

### 1. Envelope Extraction / 包络提取
- 各工况位移、内力最大值提取
- 包络组合与工况溯源

### 2. Key Metrics / 关键指标
- 最大位移（绝对值）
- 最大轴力、剪力、弯矩
- 支座反力

### 3. Controlling Cases / 控制工况
- 确定各指标的支配荷载组合
- 提供工况名称与对应最大值

### 4. Clause Traceability / 条款溯源性
- 规范校核结果的条款关联
- 便于报告中引用具体条文
