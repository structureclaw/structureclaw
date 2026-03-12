# Coding Conventions

## Scope

This document maps conventions visible in the current repository state across `backend/`, `frontend/`, `core/`, and `scripts/`. It describes observed patterns, not idealized standards.

## Language And Runtime Split

- `backend/` is strict TypeScript compiled with `tsc`, uses ES modules, and imports local files with `.js` suffixes from source files such as `backend/src/index.ts` and `backend/src/services/agent.ts`.
- `frontend/` is Next.js App Router TypeScript, also strict, but follows a different formatter style from the backend. Components such as `frontend/src/components/ui/button.tsx` and pages such as `frontend/src/app/(marketing)/page.tsx` use no semicolons.
- `core/` is Python with FastAPI + Pydantic v2 models. Files such as `core/main.py` and `core/schemas/structure_model_v1.py` use typed models and dictionary-shaped response envelopes.
- `scripts/` is Bash-first for validation and operational flows, with inline Node or Python snippets when contract checks need direct runtime assertions, for example `scripts/validate-agent-orchestration.sh` and `scripts/validate-analyze-contract.sh`.

## Formatting By Area

### Backend TypeScript

- Semicolons are standard in source files such as `backend/src/index.ts` and `backend/src/services/agent.ts`.
- String literals are predominantly single-quoted.
- Indentation is 2 spaces.
- Imports are grouped with external packages first, then local imports.
- Type aliases, interfaces, and exported classes are common. `backend/src/services/agent.ts` uses a dense exported type surface instead of keeping types private.
- Relative imports to local modules include `.js` extensions because the package runs as ESM after compilation.

### Frontend TypeScript And React

- Semicolons are generally omitted in files such as `frontend/src/components/ui/button.tsx`, `frontend/src/lib/utils.ts`, and `frontend/src/app/(marketing)/page.tsx`.
- Imports use double quotes in several shadcn-style utility/component files such as `frontend/src/components/ui/button.tsx` and `frontend/src/lib/utils.ts`, while app files often use single quotes. The repo is not fully style-normalized.
- Indentation is 2 spaces.
- Tailwind utility strings are kept inline in JSX or `cva(...)` definitions rather than extracted.
- Client components explicitly declare `'use client'` when hooks or browser APIs are required, for example `frontend/src/app/(marketing)/page.tsx` and `frontend/src/lib/stores/context.tsx`.

### Python Core

- Indentation is 4 spaces.
- Files commonly start with a module docstring, for example `core/main.py` and `core/design/code_check.py`.
- Type hints are pervasive for models and public methods.
- Imports follow standard library, third-party, then local modules.
- The codebase mixes English identifiers with Chinese user-facing comments and descriptions.

### Bash And Validation Scripts

- Validation scripts use `#!/usr/bin/env bash` and almost always enable `set -euo pipefail`, for example `scripts/check-core-regression.sh` and `scripts/validate-static-regression.sh`.
- Scripts resolve repo root with `ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"` and then `cd "$ROOT_DIR"`.
- Output is human-readable and checkpointed with `echo "==> ..."` sections.

## Naming Patterns

- TypeScript source filenames are lowercase domain names, not React PascalCase filenames: `backend/src/services/agent.ts`, `frontend/src/components/language-toggle.tsx`.
- Python filenames are snake_case: `core/fem/static_analysis.py`, `core/schemas/structure_model_v1.py`.
- React component symbols are PascalCase even when filenames are lowercase, for example `Button` in `frontend/src/components/ui/button.tsx`.
- TypeScript functions and variables use camelCase: `registerPlugins`, `checkDatabase`, `createAppStore`.
- Python methods and functions use snake_case, with internal helpers prefixed by `_` in files such as `core/design/code_check.py`.
- Type aliases and interfaces use PascalCase in backend TypeScript: `AgentRunParams`, `AgentRunResult`, `AgentInteraction`.
- Constants are inconsistent by language:
  - TS runtime constants often use `const camelCase`.
  - Python class-level constants use `UPPER_SNAKE_CASE`, for example `SUPPORTED_CODES` in `core/design/code_check.py`.

## Type And Schema Discipline

- Backend TypeScript runs with `"strict": true` in `backend/tsconfig.json`, but the lint config in `backend/.eslintrc.cjs` explicitly turns off `@typescript-eslint/no-explicit-any`. This is a pragmatic codebase, not a purity-first one.
- Frontend TypeScript also runs with `"strict": true` in `frontend/tsconfig.json`.
- Backend request and response shapes are explicitly modeled with TypeScript interfaces in service files such as `backend/src/services/agent.ts`.
- Core schema integrity relies on Pydantic model validation. `core/schemas/structure_model_v1.py` encodes both field constraints and cross-reference validation via `@model_validator(mode="after")`.
- API contracts in `core/main.py` are built from Pydantic request/response models plus manually assembled error envelopes.

## Import And Module Patterns

- Backend local imports use `.js` suffixes from TypeScript source because compiled ESM is the runtime target, for example `import { config } from './config/index.js';` in `backend/src/index.ts`.
- Both backend and frontend define `@/*` path aliases in `backend/tsconfig.json` and `frontend/tsconfig.json`, but frontend usage is much heavier.
- Frontend components frequently import shared helpers via `@/lib/utils` and compose variant systems with `class-variance-authority`.
- The core Python service imports local packages by manipulating import roots indirectly through execution context or `sys.path.insert(0, 'core')` inside validation scripts like `scripts/validate-analyze-contract.sh`.

## React Patterns

- Functional components are the standard; no class components were observed.
- `forwardRef` is used for shared UI primitives such as `frontend/src/components/ui/button.tsx`.
- Variant-heavy UI components are defined with `cva(...)` and merged with `cn(...)`, as seen in `frontend/src/components/ui/button.tsx` and `frontend/src/lib/utils.ts`.
- Store access uses a provider + selector hook pattern around Zustand in `frontend/src/lib/stores/context.tsx`.
- Route group structure is a real convention, not incidental. Layout and page composition live under `frontend/src/app/(marketing)/` and `frontend/src/app/(console)/`.

## Error Handling And Response Shapes

- Backend orchestration code favors structured result objects over thrown errors at service boundaries. `backend/src/services/agent.ts` returns `success`, `toolCalls`, `metrics`, `interaction`, and `response` in a single object.
- Error codes are uppercase underscore strings, for example `CODE_CHECK_EXECUTION_FAILED`, `INVALID_STRUCTURE_MODEL`, and `INVALID_ANALYSIS_TYPE`.
- Core FastAPI endpoints raise `HTTPException` with detailed `detail` payloads rather than plain strings, as in `core/main.py`.
- Validation scripts fail fast via `set -euo pipefail` or `SystemExit` in inline Python/Node snippets.

## Comments, Language, And Documentation Style

- Chinese comments remain common in backend and core service code, for example `// 注册插件` in `backend/src/index.ts` and `# 配置日志` in `core/main.py`.
- Python docstrings are used for modules, endpoints, and methods.
- Frontend code tends to prefer self-describing structure over heavy comments; comments there mostly explain test environment polyfills or non-obvious store behavior in files like `frontend/tests/setup.ts` and `frontend/src/lib/stores/context.tsx`.
- User-facing copy can be bilingual, but current UI and orchestration flows lean Chinese-first.

## Logging And Observability

- Backend uses a shared logger instance wired into Fastify in `backend/src/index.ts`; this is the default logging path rather than ad hoc `console.log`, although startup/shutdown still prints directly.
- Core uses the standard `logging` module with `logging.basicConfig(level=logging.INFO)` in `core/main.py`.
- Validation scripts print `[ok]`, `[fail]`, and `[warn]` markers for manual diagnosis.

## Testing-Conscious Conventions In Production Code

- Service classes expose mutable collaborators that tests can replace directly. In `backend/src/services/agent.ts`, instance properties like `engineClient` and `llm` are test seams.
- Frontend code relies on accessible roles, visible text, and stable placeholders, which is reinforced by tests under `frontend/tests/`.
- Core analysis contracts are stable dictionary envelopes with predictable top-level keys because regression scripts inspect those paths directly, for example `result.data.envelope.maxAbsDisplacement` in `scripts/validate-analyze-contract.sh`.

## Practical Guidance For Future Changes

- Match local style instead of imposing a repo-wide formatter:
  - Use semicolons and `.js` relative imports in `backend/src/**`.
  - Follow the existing no-semicolon React/Tailwind style in `frontend/src/**`.
  - Keep typed Pydantic models and explicit response envelopes in `core/**`.
- Preserve explicit contract fields once introduced. Validation scripts in `scripts/` assert exact keys and behavior.
- When adding tests or contract scripts, prefer deterministic inline fixtures and direct runtime assertions over broad snapshot-style checks.
