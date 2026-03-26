---
id: opensees-seismic
zhName: OpenSees 抗震分析
enName: OpenSees Seismic Analysis
zhDescription: 使用 OpenSees 执行反应谱、Pushover 等抗震分析的 skill。
enDescription: Skill for seismic response-spectrum and pushover analysis using OpenSees.
software: opensees
analysisType: seismic
engineId: builtin-opensees
adapterKey: builtin-opensees
priority: 145
triggers: ["OpenSees 抗震分析", "反应谱分析", "pushover", "opensees seismic", "response spectrum"]
stages: ["analysis"]
capabilities: ["analysis-policy", "analysis-execution"]
supportedModelFamilies: ["frame", "truss", "generic"]
autoLoadByDefault: true
runtimeRelativePath: runtime.py
---
# OpenSees Seismic Analysis

- `zh`: 当需求是反应谱、Pushover 或其他更高保真的抗震求解时使用。
- `en`: Use when the request targets response-spectrum, pushover, or other higher-fidelity seismic solving.
- Runtime: `analysis/opensees-seismic/runtime.py`
