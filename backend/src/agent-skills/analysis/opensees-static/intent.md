---
id: opensees-static
zhName: OpenSees 静力分析
enName: OpenSees Static Analysis
zhDescription: 使用 OpenSees 执行静力/线弹性分析的 skill。
enDescription: Skill for static and linear-elastic analysis using OpenSees.
software: opensees
analysisType: static
engineId: builtin-opensees
adapterKey: builtin-opensees
priority: 140
triggers: ["OpenSees 静力分析", "静力分析", "线性静力", "opensees static", "static analysis"]
stages: ["analysis"]
capabilities: ["analysis-policy", "analysis-execution"]
supportedModelFamilies: ["frame", "truss", "generic"]
autoLoadByDefault: true
runtimeRelativePath: runtime.py
---
# OpenSees Static Analysis

- `zh`: 当用户明确要求 OpenSees 静力分析、线弹性求解、位移/内力/反力结果时使用。
- `en`: Use when the request explicitly asks for OpenSees static solving or detailed displacement / force / reaction results.
- Runtime: `analysis/opensees-static/runtime.py`
