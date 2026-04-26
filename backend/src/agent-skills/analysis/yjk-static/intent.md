---
id: yjk-static
zhName: YJK 静力分析
enName: YJK Static Analysis
zhDescription: 使用 YJK (盈建科) 引擎自动建模并执行静力分析，提取节点位移、构件内力、楼层刚度等结构化结果（需安装 YJK 8.0 并配置 YJKS_ROOT 或 YJK_PATH）。
enDescription: Automated modeling and static analysis using the YJK engine. Extracts node displacements, member forces, and floor statistics as structured results (requires YJK 8.0 and YJKS_ROOT or YJK_PATH).
software: yjk
analysisType: static
engineId: builtin-yjk
adapterKey: builtin-yjk
priority: 125
triggers: ["YJK 静力分析", "YJK 计算", "盈建科", "yjk static", "yjk analysis"]
stages: ["analysis"]
capabilities: ["analysis-policy", "analysis-execution"]
supportedModelFamilies: ["frame", "generic"]
runtimeRelativePath: runtime.py
---
# YJK Static Analysis

- `zh`: 当用户要求使用 YJK（盈建科）进行结构静力计算、设计验算时使用。自动将 V2 模型转换为 YJK 格式，启动盈建科软件执行建模、前处理，并自动触发整体计算。由于 YJK 计算时间不可预测，系统会在模型导入和预处理完成后立即返回成功，计算在 YJK 中后台继续进行。请提示用户在 YJK 软件中查看计算进度和结果。需要已安装 YJK 8.0 并配置 `YJKS_ROOT` 或 `YJK_PATH` 指向安装根目录。
- `en`: Use when the request asks for YJK-based structural static analysis or design checks. Automatically converts V2 model to YJK format, launches YJK for modeling and preprocessing, then kicks off the full calculation. Since YJK calculation time is unpredictable, the system returns success immediately after model import and preprocessing. The calculation continues running in the YJK GUI. Prompt the user to check progress and results in the YJK application. Requires YJK 8.0 and `YJKS_ROOT` or `YJK_PATH` pointing to the install root.
- Runtime: `analysis/yjk-static/runtime.py`
