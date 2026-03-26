---
id: opensees-nonlinear
zhName: OpenSees 非线性分析
enName: OpenSees Nonlinear Analysis
zhDescription: 面向 OpenSees 非线性分析需求识别与路由的 skill。
enDescription: Skill for recognizing and routing OpenSees nonlinear analysis requests.
software: opensees
analysisType: nonlinear
engineId: builtin-opensees
adapterKey: builtin-opensees
priority: 160
triggers: ["OpenSees 非线性分析", "非线性分析", "材料非线性", "opensees nonlinear", "nonlinear analysis"]
stages: ["analysis"]
capabilities: ["analysis-policy", "analysis-execution"]
supportedModelFamilies: ["frame", "truss", "generic"]
autoLoadByDefault: true
runtimeRelativePath: runtime.py
---
# OpenSees Nonlinear Analysis

- `zh`: 用于识别“必须走 OpenSees 非线性能力”的需求，即使当前运行时仍可能返回未实现。
- `en`: Use to route requests that specifically require OpenSees nonlinear capability, even if runtime execution is not fully implemented yet.
- Runtime: `analysis/opensees-nonlinear/runtime.py`
