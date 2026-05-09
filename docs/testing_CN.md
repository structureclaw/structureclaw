# 测试分类

本文是 StructureClaw 的测试地图，定义每类测试负责什么、由哪个命令运行，以及 CI workflow 之间哪里允许有重叠。

第一版只更新文档，不改变当前 workflow 行为。它用于先解决 issue #234 中“测试边界不清楚”的问题。

## 分类定义

| 分类 | 负责内容 | 不负责内容 | 主要命令 |
| --- | --- | --- | --- |
| Unit | 纯函数、小型 helper、reducer、schema 解析、本地组件行为 | 进程启动、真实浏览器流程、真实 LLM 调用 | `npm test --prefix backend -- --runInBand` 或 `npm run test:run --prefix frontend` |
| Integration | 一个有边界的子系统，例如 route handler + service 行为，或带 provider 的页面渲染 | 完整安装启动、真实外部服务、模型质量评分 | Backend Jest 或 frontend Vitest integration 配置 |
| E2E | 面向用户的浏览器流程，运行在真实启动的应用上 | 确定性的工程分析回归、深层 backend contract、LLM 质量 benchmark | `npm run test:e2e --prefix frontend` |
| Regression | 不能随意漂移的确定性行为，尤其是工程分析与 backend contract bundle | 探索式浏览器检查、真实模型质量 | `node tests/runner.mjs backend-regression` 或 `node tests/runner.mjs analysis-regression` |
| Validation | 可单独选择的 contract 和 schema 校验 | 大范围 build/lint/test 组合 | `node tests/runner.mjs validate <name>` |
| Smoke | 支持平台上的安装、初始化、构建和生命周期兼容性 | 不拥有 unit、integration、E2E 覆盖 | `node tests/runner.mjs smoke-native` |
| LLM integration | 旧的真实 LLM 与 routing integration 检查 | 长期 agent 质量评分 | `node tests/runner.mjs llm-integration` |
| LLM benchmark | 带场景评分的真实 LangGraph agent 质量检查 | 快速确定性的 unit 或 contract 覆盖 | `node tests/runner.mjs llm-benchmark` |

## 测试归属

| 位置 | 分类归属 | Runner |
| --- | --- | --- |
| `backend/tests/*.test.mjs` | Backend unit 或 backend integration，取决于 fixture 范围 | `npm test --prefix backend -- --runInBand` |
| `backend/src/**/__tests__/*.test.mjs` | Backend unit 或聚焦的子系统 integration | `npm test --prefix backend -- --runInBand` |
| `backend/src/agent-skills/**/__tests__/*` | Skill unit、handler 或 skill integration 覆盖 | `npm test --prefix backend -- --runInBand` 或 skill 专用 npm script |
| `frontend/tests/*.test.ts(x)` | Frontend unit 与配置覆盖 | `npm run test:run --prefix frontend` |
| `frontend/tests/components/**` | 组件级 unit 和交互覆盖 | `npm run test:run --prefix frontend` |
| `frontend/tests/integration/**` | 页面、provider、route group 的 frontend integration 覆盖 | `npm run test:run:integration --prefix frontend` |
| `frontend/tests/e2e/**` | Playwright 浏览器 E2E 覆盖 | `npm run test:e2e --prefix frontend` |
| `tests/regression/backend-validations.js` | 命名 validation contract | `node tests/runner.mjs validate <name>` |
| `tests/regression/backend-regression.js` | Backend regression bundle | `node tests/runner.mjs backend-regression` |
| `tests/regression/analysis-runner.py` | Analysis regression fixture | `node tests/runner.mjs analysis-regression` |
| `tests/smoke/**` | Native install 与 build smoke 检查 | `node tests/runner.mjs smoke-native` |
| `tests/llm-integration/**` | 旧 LLM integration harness 与 helper unit test | `node tests/runner.mjs llm-integration` 加本地 helper 测试 |
| `tests/llm-benchmark/**` | LangGraph agent benchmark 场景与评分 | `node tests/runner.mjs llm-benchmark` |

## CI Workflow 边界

| Workflow | 用途 | 说明 |
| --- | --- | --- |
| `.github/workflows/backend-regression.yml` | Linux 和 Windows 上的 backend regression | 通过 `tests/runner.mjs` 运行 backend regression bundle。 |
| `.github/workflows/analysis-regression.yml` | Linux 和 Windows 上的确定性 analysis regression | 构建 backend，准备 analysis Python，然后运行分析 fixture。 |
| `.github/workflows/e2e.yml` | Playwright 浏览器流程 | 在 `master`、手动触发，或允许用户评论 `/test-e2e` 时运行。 |
| `.github/workflows/install-smoke.yml` | Native install/build 兼容性 smoke | 当前也会运行 frontend type-check/tests/lint 和 backend lint。把这些视作兼容性 gate，而不是测试归属。 |
| `.github/workflows/llm-integration.yml` | 真实 LLM integration 检查 | 在 `master`、手动触发，或允许用户评论 `/test-llm` 时运行。 |
| `.github/workflows/publish-npm.yml` | 发布前 gate | 为保护发布重复运行部分检查。它不拥有新增测试覆盖。 |

## 如何选择测试

使用能证明行为的最小分类：

- Backend 逻辑或 route 行为：添加或运行定向 Jest；如果可能影响 contract，再运行 `node tests/runner.mjs backend-regression`。
- Frontend 组件或状态行为：添加或运行 Vitest，并运行 `npm run type-check --prefix frontend`。
- 跨页面浏览器行为：使用 Playwright E2E。
- 工程分析输出、converter 行为、schema contract 或 agent orchestration payload：使用命名 validation 或 analysis regression。
- CLI setup、install、build 和平台兼容性：使用 smoke test。
- 真实 LLM agent 质量：使用 LLM benchmark。不要把模型质量断言塞进确定性的 unit 或 E2E 测试。

## 重叠规则

- 每个测试文件应有一个分类归属和一个主要 runner。
- CI workflow 可以调用组合命令做 gate，但 CI 中重复运行某个命令不代表测试归属转移。
- Release 和 smoke workflow 可以重复 build、lint 或 test 命令作为兼容性 gate。除非 workflow 本身就是目标，否则不要在那里新增分类专属断言。
- 不要用 E2E 测试覆盖确定性的 backend contract 或工程 fixture。
- 不要用 unit、validation 或 E2E 测试判断真实 LLM 答案质量。应使用 `tests/llm-benchmark/**`。
- 为后续 test issue 增加覆盖时，先把新测试放到负责该行为的分类下；只有当该分类缺少 CI 入口时，才补 CI wiring。

## 当前明确出来的差距

- E2E 目前覆盖浏览器层流程，例如导航、i18n/theme、capabilities、database admin 和 console chat smoke。它不是完整的 agent 质量套件。
- `install-smoke.yml` 的目标是 install/build 兼容性，但当前会重复部分 frontend 和 backend 静态检查。
- `llm-integration` 和 `llm-benchmark` 现在都会触及真实 LLM 行为。新增 agent 质量场景应优先走 benchmark 路径。
- Issue #234 应先确定边界和文档。缺失覆盖由单独的后续 issue 补测试。
