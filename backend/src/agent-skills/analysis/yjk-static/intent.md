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

- `zh`: 当用户要求使用 YJK（盈建科）进行结构静力计算、设计验算时使用。自动将 V2 模型转换为 YJK 格式，默认通过 SDK `RunYJK(yjks.exe)` 直接启动盈建科软件执行建模、前处理、整体计算，并在计算完成后抽取节点位移、构件内力、包络和楼层统计等结构化结果。需要已安装 YJK 8.0 并配置 `YJKS_ROOT` 或 `YJK_PATH` 指向安装根目录；如某台机器的在线授权需要官方启动器先初始化，运行时会在检测到授权失败后启动 `YjkLauncher.exe` 预热授权并重新直接启动 `yjks.exe`，也可设 `YJK_LAUNCHER_PREWARM=1` 在首次直接启动前预热。若只想启动计算不等待，可设置 `YJK_START_ONLY=1` 或 `YJK_ASYNC_CALC=1`。
- `en`: Use when the request asks for YJK-based structural static analysis or design checks. Automatically converts the V2 model to YJK format, launches YJK through the SDK `RunYJK(yjks.exe)` direct path for modeling, preprocessing, and full calculation, then extracts structured node displacements, member forces, envelopes, and floor statistics after completion. Requires YJK 8.0 and `YJKS_ROOT` or `YJK_PATH` pointing to the install root. If a machine's online authorization needs the official launcher to initialize first, the runtime detects the authorization failure, starts `YjkLauncher.exe` to prewarm authorization, and retries the direct `yjks.exe` launch; set `YJK_LAUNCHER_PREWARM=1` to prewarm before the first direct launch. Set `YJK_START_ONLY=1` or `YJK_ASYNC_CALC=1` only when starting the calculation without waiting is desired.
- Runtime: `analysis/yjk-static/runtime.py`
