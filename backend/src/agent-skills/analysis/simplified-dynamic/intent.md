---
id: simplified-dynamic
zhName: 简化动力分析
enName: Simplified Dynamic Analysis
zhDescription: 使用简化内置求解器执行轻量动力分析的 skill。
enDescription: Skill for lightweight dynamic analysis using the simplified builtin solver.
software: simplified
analysisType: dynamic
engineId: builtin-simplified
adapterKey: builtin-simplified
priority: 50
triggers: ["简化动力分析", "快速模态分析", "simplified dynamic", "lightweight dynamic"]
stages: ["analysis"]
capabilities: ["analysis-policy", "analysis-execution"]
supportedModelFamilies: ["frame", "truss", "generic"]
autoLoadByDefault: true
runtimeRelativePath: runtime.py
---
# Simplified Dynamic Analysis

- `zh`: 用于快速模态、近似动力响应和 OpenSees 不可用时的动力回退路径。
- `en`: Use for fast modal estimation and dynamic fallback when OpenSees is unavailable.
- Runtime: `analysis/simplified-dynamic/runtime.py`
