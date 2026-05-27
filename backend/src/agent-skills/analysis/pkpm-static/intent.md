# PKPM Static Analysis

- `zh`: 当用户明确要求使用 PKPM/SATWE 进行结构静力计算、商业引擎复核、设计验算或结果对比时使用。需要本机安装 PKPM，并通过 General Settings / `settings.json` 的 `pkpm.cyclePath` 或环境变量 `PKPM_CYCLE_PATH` 指向 `JWSCYCLE.exe`。
- `en`: Use when the user explicitly asks for PKPM/SATWE structural static analysis, commercial-engine verification, design checks, or result comparison. Requires a local PKPM installation and `pkpm.cyclePath` in General Settings / `settings.json`, or `PKPM_CYCLE_PATH`, pointing to `JWSCYCLE.exe`.
- `zh`: 该 skill 与 YJK 一样属于显式选择的商业分析 provider；是否可执行取决于本机软件、Python API、授权和 runtime probe 状态。
- `en`: Like YJK, this skill is an explicit commercial analysis provider; executability depends on the local software, Python API, license state, and runtime probe status.
- Runtime: `analysis/pkpm-static/runtime.py`
