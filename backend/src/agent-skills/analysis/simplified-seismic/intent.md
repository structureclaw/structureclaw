---
id: simplified-seismic
zhName: 简化抗震分析
enName: Simplified Seismic Analysis
zhDescription: 使用简化内置求解器执行轻量抗震分析的 skill。
enDescription: Skill for lightweight seismic analysis using the simplified builtin solver.
software: simplified
analysisType: seismic
engineId: builtin-simplified
adapterKey: builtin-simplified
priority: 45
triggers: ["简化抗震分析", "快速抗震分析", "simplified seismic", "lightweight seismic"]
stages: ["analysis"]
capabilities: ["analysis-policy", "analysis-execution"]
supportedModelFamilies: ["frame", "truss", "generic"]
autoLoadByDefault: true
runtimeRelativePath: runtime.py
---
# Simplified Seismic Analysis

- `zh`: 适用于轻量反应谱、简化抗震验算或 OpenSees 回退路径。
- `en`: Use for lightweight response-spectrum style checks or as the seismic fallback path.
- Runtime: `analysis/simplified-seismic/runtime.py`
