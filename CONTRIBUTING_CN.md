# StructureClaw 贡献指南

## 适用范围

本指南适用于 `frontend`、`backend`、`scripts`、`docs` 的开源协作。

默认采用常见的 Fork + Pull Request 工作方式。

## 开始前

1. 先阅读 [README_CN.md](/home/openclaw/structureclaw/README_CN.md)、[docs/handbook_CN.md](/home/openclaw/structureclaw/docs/handbook_CN.md)、[docs/reference_CN.md](/home/openclaw/structureclaw/docs/reference_CN.md)。
2. 确认本地开发环境可用：

```bash
make doctor
make start
make status
```

3. 如果你的改动涉及 chat、agent orchestration、report、converter 或 schema，请在开始前先确认对应的 `scripts/validate-*.sh` 校验脚本。

## 核心协作原则

- 改动保持小步、聚焦。
- 保持 `frontend`、`backend` 以及 backend-hosted analysis skills 的模块边界清晰。
- 不要把无关重构混入功能或修复 PR。
- 所有用户可见文案必须同时支持英文和中文。
- 把“可回归、可复现、可脚本化”当作功能的一部分，不要随意改变 schema、fixture、回归输出或契约载荷。

## 推荐的 Git 工作流

推荐使用简洁的流式工作法，这样你的 Fork 更容易长期维护。

### 1. 保持 `master` 纯净

你 Fork 仓库中的 `master` 只用于同步上游仓库，不要直接在上面开发。

建议一次性完成 upstream 配置：

```bash
git remote add upstream <upstream-repository-url>
git fetch upstream
```

### 2. 每次改动都新建功能分支

每次开发新功能、修复问题或更新文档时，都从最新的 `master` 拉出新分支：

```bash
git checkout master
git pull upstream master
git checkout -b my-feature
```

推荐分支命名：

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `refactor/short-description`
- `test/short-description`

例如：

- `feat/builtin-skill-taxonomy`
- `fix/chat-stream-fallback`
- `docs/refresh-contributing-guide`

### 3. 小步提交，保持逻辑边界清晰

- 当实现、测试、文档能分开评审时，尽量拆成独立 commit。
- 不要等一个大任务做完后再把无关内容一次性打包提交。
- 如果一个变更天然可以拆成几个清晰步骤，尽量在 git 历史中保留这种结构。

建议使用 conventional commit，例如：

- `feat(frontend): add bilingual report summary panel`
- `fix(backend): fallback unmatched skills to generic no-skill flow`
- `docs: refresh handbook and protocol reference`

### 4. 用功能分支提交 PR

不要从 `master` 提 PR，而是从你的功能分支提交：

```bash
git push origin my-feature
```

然后使用 `my-feature` 分支向上游仓库的 `master` 提交 Pull Request。

### 5. Squash 合并后的清理方式

如果 PR 使用 Squash 方式合并，推荐按下面的方式清理本地分支：

```bash
git checkout master
git pull upstream master
git branch -d my-feature
```

此时本地 `master` 应该是 Fast-forward 更新，不需要再去 rebase 已经合并过的功能分支。  
如果还想顺手删除你 Fork 上的远程分支，可以执行：

```bash
git push origin --delete my-feature
```

## 开发要求

### 仓库边界

- Backend：保持路由层轻量，把编排和领域逻辑放进 services。
- Frontend：路由与布局放在 app routes，可复用 UI 放在 components。
- 分析运行时：保持引擎、schema、回归逻辑的确定性与可脚本化。
- Scripts：优先扩展现有验证脚本，而不是新增一次性本地辅助脚本。

### 语言与用户体验要求

- 不要新增单语用户流程。
- 新增 UI 文案、提示词、空状态、报告标签和生成式说明时，必须同时支持 `en` 与 `zh`。
- 涉及 locale 的显示内容，应跟随前端当前语言设置。

### 编码要求

- TypeScript：保持 strict mode，在关键边界写清楚类型，API 层保持薄。
- Python：遵循现有 FastAPI / Pydantic 风格，代码可读且尽量带类型。
- 除非 PR 本身就是重构，否则尽量避免顺手做大范围无关整理。

## 验证清单

根据改动范围运行对应命令。

后端相关：

```bash
npm run build --prefix backend
npm run lint --prefix backend
npm test --prefix backend -- --runInBand
```

前端相关：

```bash
npm run build --prefix frontend
npm run type-check --prefix frontend
npm run test:run --prefix frontend
```

分析运行时与跨服务验证：

```bash
make backend-regression
make analysis-regression
```

常用定向校验：

```bash
./scripts/validate-agent-orchestration.sh
./scripts/validate-chat-stream-contract.sh
./scripts/validate-analyze-contract.sh
./scripts/validate-converter-api-contract.sh
```

按改动类型的最低期望：

- Backend / 契约改动：覆盖成功、失败、缺参三类场景。
- Frontend 改动：至少运行定向测试和 `type-check`；涉及路由、布局、provider 时再跑 `build`。
- 分析运行时改动：保持回归算例稳定，若需要更新预期输出，请在 PR 中明确说明原因。
- 纯文档改动：不强制跑代码测试，但要确保命令、路径、接口名称准确。

## Pull Request 要求

PR 的质量比 PR 的体积更重要，但强烈建议保持小而可评审。

### PR 标题

建议使用清晰标题，优先采用 conventional commit 风格：

- `feat(backend): split builtin skill runtime responsibilities`
- `fix(frontend): keep report locale consistent`
- `docs: clarify fork and PR workflow`

### PR 描述应包含

每个 PR 建议至少写清楚：

- 改了什么
- 为什么要改
- 影响范围：`frontend`、`backend`、`scripts`、`docs`
- 执行过哪些命令，以及结果如何
- 如果是 UI 改动，补充截图会更好
- 如果改动了 API 或契约，附上请求/响应示例
- 如果行为不完全兼容旧版本，补充迁移或兼容说明

### PR 范围控制

一个好的 PR 通常只解决一个清晰目标：

- 一个功能
- 一个修复
- 一个重构
- 一次文档改进

如果 reviewers 需要同时评估多种无关风险，就应该考虑拆 PR。

### PR Review 预期

- 收到 review 意见后，请在同一个分支继续更新。
- 如果 review 导致行为变化，请同步补测试或文档。
- 除非是为了整理历史准备合并，否则不要随意 force-push 抹掉 review 上下文。
- 只有在问题确实处理完后，再去 resolve 对应的 review thread。

### Draft PR

以下情况建议先开 Draft PR：

- 你希望先确认方案方向
- 范围已经合理，但测试还没补完
- 存在需要先讨论的架构决策

当验证清单基本完成后，再转为 Ready for Review。

## 安全与密钥

- 不要提交真实密钥、令牌或私钥。
- 配置模板以 `.env.example` 和 `backend/.env.example` 为准。
- 生产环境凭据必须保存在仓库外。
- 如果你的改动依赖新的配置默认值，请在 PR 中说明。

## 沟通建议

- 如果你不确定某项职责应放在 backend API/services 还是 backend-hosted analysis skills，请在 PR 里写清楚你的判断依据。
- 如果改动引入了新的用户可见文案，请说明中英文支持是如何处理的。
- 如果改动影响了契约，请说明使用了哪些脚本或 fixture 做验证。

## 对应语言版本

英文版：[CONTRIBUTING.md](/home/openclaw/structureclaw/CONTRIBUTING.md)
