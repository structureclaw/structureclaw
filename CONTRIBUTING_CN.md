# StructureClaw 贡献指南

## 适用范围

本指南适用于前端、后端、分析引擎、脚本与文档协作。

## 开始前

1. 阅读 `README_CN.md`、`docs/handbook_CN.md`、`docs/reference_CN.md`。
2. 确认本地环境可用：

```bash
make doctor
make start
make status
```

## 开发规则

- 变更保持小步、聚焦。
- 保持模块边界（`frontend` / `backend` / `core`）。
- 不要把无关重构混入功能或修复提交。
- 用户可见文案必须提供中英文版本。

## 编码要求

- 后端：路由层轻量，编排逻辑放在服务层。
- 前端：避免硬编码单语用户文案。
- 引擎：保证 schema 与回归算例可复现。

## 验证清单

按变更范围运行对应命令。

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

跨服务契约：

```bash
make backend-regression
make core-regression
```

## Commit 与 PR 规范

建议使用 conventional commit，例如：

- `feat(frontend): add bilingual report summary panel`
- `fix(backend): fallback unmatched skills to generic no-skill flow`
- `docs: refresh handbook and protocol reference`

PR 建议包含：

- 改动内容与目的
- 影响模块（`frontend`、`backend`、`core`、`scripts`、`docs`）
- 已执行命令与结果
- 涉及 API/契约时附请求响应样例

## 安全与密钥

- 不要提交真实密钥。
- 配置说明以 `.env.example` 为准。
- 生产凭据必须保存在仓库外。

## 对应语言版本

英文版：`CONTRIBUTING.md`
