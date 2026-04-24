# Intent / 意图

> Manifest-first note / 清单优先说明
>
> Canonical skill metadata for this builtin design skill lives in `skill.yaml`.
> This file is content-only and no longer defines the skill id, stages, or runtime metadata.
>
> 此内置设计技能的 canonical 元数据以 `skill.yaml` 为准。
> 当前文件仅承载内容，不再定义技能 id、阶段、授权工具或运行时元数据。

## Purpose / 目的
- `zh`: 在分析完成后，根据结果和规范校核结论提出设计修正建议，支持迭代优化流程。
- `en`: After analysis completion, propose design revision suggestions based on results and code-check conclusions, supporting iterative optimization.

## Design Feedback Scope / 设计反馈范围

### 1. Utilization Review / 利用率审查
- 识别超限构件（利用率 > 1.0）
- 提出截面调整建议

### 2. Displacement Check / 位移审查
- 与规范限值比较
- 提出刚度加强建议

### 3. Model Revision / 模型修正
- 生成标准化模型补丁
- 记录修正理由与依据
