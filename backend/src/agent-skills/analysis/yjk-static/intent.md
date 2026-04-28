---
id: yjk-static
zhName: YJK 静力分析
enName: YJK Static Analysis
zhDescription: 调用本机 YJK 8.0 自动建模、计算并抽取静力分析结果，返回位移、反力、构件内力、工况、包络和楼层统计。
enDescription: Runs local YJK 8.0 modeling, calculation, and static-result extraction, returning displacements, reactions, member forces, load cases, envelopes, and floor statistics.
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

- `zh`: 当用户明确要求使用 YJK（盈建科）进行结构静力分析、商业引擎复核或与 PKPM/OpenSees 结果对比时使用。该 skill 需要本机安装 YJK 8.0，并配置 `YJKS_ROOT` 或 `YJK_PATH` 指向安装根目录。
- `en`: Use when the user explicitly asks for YJK-based structural static analysis, commercial-engine verification, or comparison against PKPM/OpenSees results. This skill requires a local YJK 8.0 installation and `YJKS_ROOT` or `YJK_PATH` pointing to the install root.
- `zh`: 执行链路为 V2/兼容模型归一化 → 生成 YDB → 通过 SDK `RunYJK(yjks.exe)` 启动 YJK → 建模修复、楼板/支座、前处理、整体计算 → 在 YJK 进程内加载 `extract_results.py` → 读取当前 run 的 `results.json` 并归一化为 StructureClaw 分析结果。
- `en`: The execution path is V2/compatible model normalization -> YDB generation -> YJK launch through SDK `RunYJK(yjks.exe)` -> model repair, slab/support setup, preprocessing, full calculation -> `extract_results.py` loaded inside the YJK process -> current-run `results.json` normalized into a StructureClaw analysis result.
- `zh`: 同步模式会返回 `displacements`、`reactions`、`forces`、`caseResults`、`envelope`、`envelopeTables`、`yjk_detailed.floor_stats` 和 `warnings`。每次运行的模型、日志、driver 输出和抽取结果写入 YJK 工作目录下的 `sc_<traceId>` 子目录；优先使用 `settings.json` / `YJK_WORK_DIR` 配置，Node 侧通常会从配置注入 `YJK_WORK_DIR`（默认 `<runtimeBaseDir>/analysis/yjk`），若仍未设置则 Python 运行时回退到 `~/.structureclaw/analysis/yjk`。
- `en`: Synchronous runs return `displacements`, `reactions`, `forces`, `caseResults`, `envelope`, `envelopeTables`, `yjk_detailed.floor_stats`, and `warnings`. Per-run models, logs, driver output, and extracted results are written under `sc_<traceId>` inside the YJK work directory; the runtime prefers `settings.json` / `YJK_WORK_DIR`, the Node runner normally injects `YJK_WORK_DIR` from config (default `<runtimeBaseDir>/analysis/yjk`), and if it is still unset the Python runtime falls back to `~/.structureclaw/analysis/yjk`.
- `zh`: 默认优先直接启动 `yjks.exe`。如果授权需要官方启动器预热，`YJK_LAUNCHER_PREWARM=auto` 会在检测到授权失败后启动 `YjkLauncher.exe` 并重试；`YJK_LAUNCHER_PREWARM=1` 可在首次直接启动前预热。`YJK_USE_LAUNCHER=1` 和 `YJK_ATTACH_EXISTING=1` 是调试/兼容路径，不是常规自动运行首选。
- `en`: The default path starts `yjks.exe` directly. If authorization needs the official launcher to initialize first, `YJK_LAUNCHER_PREWARM=auto` starts `YjkLauncher.exe` after detecting an authorization failure and retries; `YJK_LAUNCHER_PREWARM=1` prewarms before the first direct launch. `YJK_USE_LAUNCHER=1` and `YJK_ATTACH_EXISTING=1` are debugging/compatibility paths, not the preferred automatic run path.
- `zh`: 仅在确实只想启动计算、不等待结果抽取时设置 `YJK_START_ONLY=1` 或 `YJK_ASYNC_CALC=1`。这类运行会跳过 `results.json` 抽取，不能作为闭环分析结果传给下游校核和报告。
- `en`: Set `YJK_START_ONLY=1` or `YJK_ASYNC_CALC=1` only when starting calculation without waiting for result extraction is intentional. These runs skip `results.json` extraction and cannot serve as closed-loop analysis results for downstream checking or reporting.
- Runtime: `analysis/yjk-static/runtime.py`
