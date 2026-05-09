# 测试分类

本文是 StructureClaw 的测试地图，定义每类测试负责什么、由哪个命令运行，以及 CI workflow 之间哪里允许有重叠。

本文用于明确 issue #234 中的测试边界；当 workflow 边界调整时也需要同步更新。

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
| `frontend/tests/*.test.ts(x)` 以及 `frontend/tests/lib/**`、`frontend/tests/stores/**`、非 console 的 `frontend/tests/components/**` | Frontend unit 与配置覆盖 | `npm run test:run --prefix frontend` |
| `frontend/tests/components/console/**` | 组合后的 AI console、能力 hydration、流式响应和 provider 交互的 frontend integration 覆盖 | `npm run test:run:integration --prefix frontend` |
| `frontend/tests/accessibility/semantic.test.tsx` | 组合后的 console 页面语义与可访问性 integration 冒烟 | `npm run test:run:integration --prefix frontend` |
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
| `.github/workflows/frontend-regression.yml` | Linux 和 Windows 上的 frontend 静态与 unit regression | 运行 frontend type-check、lint 和 unit Vitest 覆盖。 |
| `.github/workflows/analysis-regression.yml` | Linux 和 Windows 上的确定性 analysis regression | 构建 backend，准备 analysis Python，然后运行分析 fixture。 |
| `.github/workflows/e2e.yml` | Playwright 浏览器流程 | 在 `master`、手动触发，或允许用户评论 `/test-e2e` 时运行。 |
| `.github/workflows/install-smoke.yml` | Native install/build 兼容性 smoke | 调用 `node tests/runner.mjs smoke-native`；frontend 和 backend 静态检查由各自 regression workflow 负责。 |
| `.github/workflows/llm-integration.yml` | 真实 LLM integration 检查 | 在 `master`、手动触发，或允许用户评论 `/test-llm` 时运行。 |
| `.github/workflows/publish-npm.yml` | 发布前 gate | 为保护发布重复运行部分检查。它不拥有新增测试覆盖。 |

## Frontend Vitest 拆分

Frontend 现在有两个 Vitest 配置，归属互斥：

- `frontend/vitest.config.ts` 负责快速 unit / 配置覆盖，并显式排除 `tests/integration/**`、`tests/components/console/**`、`tests/accessibility/**` 和 `tests/e2e/**`。
- `frontend/vitest.integration.config.ts` 负责 app route、provider、console integration 覆盖，并包含 `tests/integration/**/*.test.tsx`、`tests/components/console/**/*.test.tsx` 和 `tests/accessibility/semantic.test.tsx`。
- 新增 console shell 测试、依赖 provider 的页面测试、route 测试，或需要 integration backend fixture 的测试，即使渲染的是 React component，也应放入 integration runner。

## 如何选择测试

使用能证明行为的最小分类：

- Backend 逻辑或 route 行为：添加或运行定向 Jest；如果可能影响 contract，再运行 `node tests/runner.mjs backend-regression`。
- Frontend 组件或状态行为：添加或运行 Vitest，并运行 `npm run type-check --prefix frontend`。Console shell、依赖 provider 的页面、route 或 accessibility 覆盖应使用 integration Vitest runner。
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
- Frontend integration 测试已有本地命令，但 integration runner 稳定前暂不接入 CI。
- `install-smoke.yml` 现在只负责 native install/build 兼容性。
- `llm-integration` 和 `llm-benchmark` 现在都会触及真实 LLM 行为。新增 agent 质量场景应优先走 benchmark 路径。
- Issue #234 应先确定边界和文档。缺失覆盖由单独的后续 issue 补测试。
