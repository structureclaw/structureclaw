---
id: opensees-dynamic
zhName: OpenSees 动力分析
enName: OpenSees Dynamic Analysis
zhDescription: 使用 OpenSees 执行模态或时程动力分析的 skill。
enDescription: Skill for modal and time-history dynamic analysis using OpenSees.
software: opensees
analysisType: dynamic
engineId: builtin-opensees
adapterKey: builtin-opensees
priority: 150
triggers: ["OpenSees 动力分析", "模态分析", "时程分析", "opensees dynamic", "modal analysis", "time history"]
stages: ["analysis"]
capabilities: ["analysis-policy", "analysis-execution"]
supportedModelFamilies: ["frame", "truss", "generic"]
autoLoadByDefault: true
runtimeRelativePath: runtime.py
---
# OpenSees Dynamic Analysis

- `zh`: 适用于模态分析、振型提取、地震波时程响应等需要 OpenSees 动力求解器的场景。
- `en`: Use for modal extraction and time-history response cases that require the OpenSees dynamic solver.
- Runtime: `analysis/opensees-dynamic/runtime.py`
