# StructureClaw 技术栈

## 1. 仓库形态

这是一个单仓多服务项目，核心组成如下：

- `frontend`：Web 前端
- `backend`：API 与 Agent 编排层
- `core`：结构分析与转换引擎
- `scripts` + `Makefile`：开发流程与回归入口

## 2. 前端技术栈

位置：`frontend/`

- 框架：Next.js 14.1.4
- 运行时：React 18
- 语言：TypeScript
- 样式体系：Tailwind CSS 3 + PostCSS
- UI 基础组件：Radix UI
- 状态管理：Zustand
- 数据请求：TanStack React Query
- 可视化相关依赖：React Three Fiber、Drei、Three.js
- Markdown 渲染：`react-markdown`
- 主题切换：`next-themes`
- 测试：Vitest、Testing Library、jsdom
- Lint：ESLint + `next/core-web-vitals`

## 3. 后端技术栈

位置：`backend/`

- 运行时：Node.js 18+
- 框架：Fastify 4
- 语言：TypeScript
- ORM：Prisma 5
- 数据库：PostgreSQL
- 缓存：Redis，支持内存降级
- API 文档：`@fastify/swagger`、`@fastify/swagger-ui`
- LLM 集成：OpenAI SDK、LangChain
- HTTP 客户端：Axios
- 日志：Pino、Pino Pretty
- 测试：Jest
- 开发运行：`tsx`
- Lint：ESLint + `@typescript-eslint`

## 4. Core 计算引擎技术栈

位置：`core/`

- 运行时：推荐 Python 3.11
- Web 框架：FastAPI
- 服务启动：Uvicorn
- 数据建模：Pydantic v2
- 数值计算：NumPy
- 结构分析相关库：OpenSeesPy
- HTTP 客户端：HTTPX
- 引擎扩展形态：内置分析引擎注册表 + 受控 manifest 路由

## 5. 基础设施与运行层

- 容器编排：Docker Compose
- 反向代理：Nginx
- 开发命令层：Makefile + `sclaw` CLI
- 本地启动脚本：`scripts/dev-up.sh`、`scripts/dev-down.sh`、`scripts/dev-status.sh`

## 6. 质量保障与验证工具

- 前端测试：`frontend/tests`
- 后端测试：`backend/tests`
- Core 回归数据：`core/regression`
- 契约与冒烟脚本：`scripts/validate-*.sh`
- 常用入口：`make doctor/start/status/stop/backend-regression/core-regression`

## 7. 架构特征

- 单仓管理，服务边界清晰
- Backend 是 API 协议和编排边界
- Core 是工程计算边界
- Frontend 负责控制台、调试和产品交互层
- Schema 校验与格式转换是全链路共享能力

## 8. 建议环境基线

- Node.js `>=18`
- Python `3.11`
- PostgreSQL `>=14`
- Redis `>=7`
- Docker Compose v2
- 推荐使用 `uv` 管理 Python 环境
