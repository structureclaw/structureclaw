# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) / Codex when working with code in this repository.

## Project Overview

StructureClaw is an AI-assisted structural engineering workspace. It takes natural-language structural descriptions through a conversational UI and runs them through a pipeline: draft model → validate → analyze → code-check → report. The system is bilingual (`en` / `zh`); all new user-visible text must ship in both locales.

## Architecture

```text
frontend (Next.js 14)  →  backend (Fastify + Prisma)  →  analysis engine (e.g. Python analysis runtime (OpenSees))
```

- **Backend** (`backend/`): Fastify API with Prisma ORM (SQLite default). Route handlers in `src/api`, orchestration/domain logic in `src/services`, shared helpers in `src/utils`.
- **Frontend** (`frontend/`): Next.js 14 app-router. Routes in `src/app`, reusable UI in `src/components`, client state (Zustand) and i18n in `src/lib`.
- **Agent runtime** (`backend/src/agent-runtime/`): Capability-driven orchestration — base model (chat) → skill layer (engineering advisor) → tool layer (executable agent). 14 skill domains live under `backend/src/agent-skills/` (structure-type, analysis, code-check, data-input, design, drawing, general, load-boundary, material, report-export, result-postprocess, section, validation, visualization).
- **Analysis execution** (`backend/src/agent-skills/analysis/`): Spawns a Python subprocess using OpenSees for structural analysis. Python runtime lives in `~/.structureclaw/.venv/`.
- **CLI** (`scripts/cli/`): The `./sclaw` and `./sclaw_cn` commands wrap all startup, health-check, and lifecycle operations. Always prefer `./sclaw ...` over calling script paths directly.
- **Tests** (`tests/`): Regression and contract validation via `node tests/runner.mjs`.

## Build & Run

**Environment setup (first time):**
```bash
./sclaw doctor          # checks deps, installs missing, sets up ~/.structureclaw/.venv
./sclaw start           # starts backend + frontend
./sclaw status          # verify both services running
./sclaw logs            # tail logs
./sclaw stop            # graceful shutdown
```

**China mirror variant:** Replace `./sclaw` with `./sclaw_cn` for mirror defaults (npmmirror, tsinghua PyPI).

**Backend only:**
```bash
npm run build --prefix backend          # TypeScript compile
npm run lint --prefix backend           # ESLint
npm test --prefix backend -- --runInBand  # Jest (internally runs db:generate + build first)
npm run db:generate --prefix backend    # Regenerate Prisma client (required before build after schema changes)
npm run db:push --prefix backend        # Sync Prisma schema to SQLite (no migration files)
```

**Frontend only:**
```bash
npm run build --prefix frontend         # Next.js production build
npm run type-check --prefix frontend    # tsc --noEmit
npm run test:run --prefix frontend      # Vitest (all tests)
npm run lint --prefix frontend          # ESLint
npm run test:e2e --prefix frontend      # Playwright E2E tests
```

**Running a single test:**
```bash
# Backend (Jest)
npm test --prefix backend -- --runInBand path/to/test.test.ts

# Frontend (Vitest)
npm run test:run --prefix frontend -- path/to/test.test.ts
```

**Regression and validation:**
```bash
node tests/runner.mjs analysis-regression                    # OpenSees analysis regression
node tests/runner.mjs check backend-regression               # Backend regression suite (build + lint + Jest + validations)
node tests/runner.mjs validate validate-agent-orchestration  # Agent orchestration contract
node tests/runner.mjs validate validate-chat-stream-contract # Chat stream contract
node tests/runner.mjs validate validate-analyze-contract     # Analyze endpoint contract
node tests/runner.mjs smoke-native                           # Full native install smoke (mirrors CI)
node tests/runner.mjs llm-integration                        # LLM integration tests (needs LLM_API_KEY)
```

## Key Conventions

- **TypeScript**: strict mode, ES modules, 2-space indent, semicolons. Explicit types at API/store boundaries. Route handlers stay thin; logic goes into services.
- **Naming**: files = lowercase domain (`agent.ts`, `analysis.ts`), classes = `PascalCase`, functions/variables = `camelCase`, constants = `UPPER_SNAKE_CASE`.
- **Bilingual**: Every user-visible string must support `en` and `zh`. Route through the existing i18n system; never hardcode single-language strings.
- **Frontend**: Preserve Next.js app-router structure. Use existing Zustand store, i18n, and theme infrastructure. Prefer design-token styling over hardcoded light/dark values.
- **Python**: Follow existing style in analysis modules. Keep regression fixtures deterministic.
- **Immutability**: Prefer creating new objects over mutating existing ones.
- **Commits**: Conventional commit format (`feat(frontend): ...`, `fix(backend): ...`, `docs: ...`). Small logical commits with clear boundaries; don't bundle unrelated work.

## Module Boundaries

| Concern | Location |
|---------|----------|
| API routes | `backend/src/api/` |
| Agent orchestration | `backend/src/services/` and `backend/src/agent-runtime/` |
| Skill domains | `backend/src/agent-skills/<domain>/` |
| Executable agent tools | `backend/src/agent-langgraph/tool-registry.ts` and `backend/src/agent-langgraph/tools.ts` |
| Shared skill utilities | `backend/src/skill-shared/` |
| Shared helpers | `backend/src/utils/` |
| Frontend pages | `frontend/src/app/` |
| Reusable components | `frontend/src/components/` |
| Client state / i18n | `frontend/src/lib/` |
| CLI implementation | `scripts/cli/` |

## Configuration

All user-facing settings are stored in `settings.json` (managed via the frontend Settings UI or the admin API). Key settings:

- `llm.apiKey`, `llm.model`, `llm.baseUrl`
- `database.url` — SQLite by default (`file:~/.structureclaw/data/structureclaw.db`)
- `analysis.pythonBin` — leave blank for auto-detected `~/.structureclaw/.venv` Python

Infrastructure-only env vars: `SCLAW_DATA_DIR`, `NODE_ENV`.

## Testing Guidance

- Backend: cover success, failure, and missing-input scenarios. Run `npm test --prefix backend -- --runInBand`.
- Frontend: run targeted Vitest checks plus `type-check`. Run `build` when layout/routing changes.
- Both `en` and `zh` paths must be verified for new user-visible frontend features.
- Analysis runtime: keep regression fixtures deterministic; don't casually change expected outputs.
- If changes affect chat, agent orchestration, report output, converters, or schema — run `node tests/runner.mjs validate <name>`.

## Agent Architecture Reference

The agent is capability-driven, not mode-driven:
1. **Base model** (always present): general dialogue, fallback when no engineering capabilities are loaded.
2. **Skill layer** (optional): engineering intent classification, parameter extraction, guidance.
3. **Tool layer** (optional): executable engineering actions (analyze, validate, code-check, report).

See `docs/agent-architecture.md` for the full canonical design reference.

## Security and Config

- Never commit live secrets, tokens, or private keys.
- All configuration is managed through `settings.json` via the frontend UI or admin API.
- Backend runtime depends on settings.json for the OpenAI-compatible LLM interface and infrastructure; document any new defaults or required settings.
- When documenting LLM setup, prefer the existing OpenAI-compatible `llm.apiKey` + `llm.baseUrl` + `llm.model` pattern in settings.json.

## Commit and PR Guidance
- Follow conventional commit style, for example:
  - `feat(frontend): add bilingual light and dark experience`
  - `fix(frontend): stop chat auto-scroll from locking wheel`
  - `docs: map existing codebase`
- Commit in small batches with clean boundaries and do not postpone commits once a logical slice is complete.
- Preferred sequence when applicable:
  - implementation changes first
  - tests in a separate commit when that improves reviewability
  - docs or workflow-note follow-ups in their own commit
- PRs should state:
  - what changed and why
  - impacted areas (`backend`, `frontend`, `scripts`, `docs`)
  - commands run and results
  - sample request/response when API behavior changed

## Skill Development

A skill is the unit of extensibility in the agent. Each skill lives under `backend/src/agent-skills/<domain>/` and consists of two parts:

### 1. Skill Manifest (`skill.yaml`)

Required file. Declares identity, capabilities, and routing. Schema validated by `backend/src/agent-runtime/manifest-schema.ts`. Key fields:

```yaml
id: frame                          # unique skill identifier
domain: structure-type              # one of 14 domains (see ALL_SKILL_DOMAINS)
name: { zh: 规则框架, en: Regular Frame }
description: { zh: ..., en: ... }
triggers: [frame, 框架, steel frame] # keywords for intent detection
stages: [intent, draft, analysis, design]
structureType: frame               # maps to InferredModelType
priority: 70                       # higher = preferred when multiple skills match
compatibility:
  minRuntimeVersion: "0.1.0"
  skillApiVersion: v1
```

### 2. Stage Markdown (`<stage>.md`, at least one required)

Markdown files (`intent.md`, `draft.md`, `analysis.md`, `design.md`) that provide domain knowledge prompts injected into the LLM context at each pipeline stage. Content-only; no YAML frontmatter. At least one stage `.md` file is required for the `AgentSkillLoader` to discover the skill directory.

### 3. Handler Module (`handler.ts`, optional but required for interactive skills)

Exports a `SkillHandler` object (interface defined in `backend/src/agent-runtime/types.ts`). The handler methods form the skill's lifecycle:

```
detectStructuralType()  → match user message to this skill's structural type
parseProvidedValues()   → normalize explicit user input into DraftExtraction
extractDraft()          → combine LLM extraction + rules into DraftExtraction
mergeState()            → immutable merge of existing state + new patch
computeMissing()        → return critical/optional missing fields
mapLabels()             → localize missing-field keys for display
buildQuestions()        → generate InteractionQuestion[] for missing fields
buildDefaultProposals() → suggest default values (optional)
buildModel()            → produce the final computable model JSON
resolveStage()          → determine pipeline stage from current state (optional)
buildReportNarrative()  → custom report narrative (optional)
```

### Creating a New Skill

1. Create directory: `backend/src/agent-skills/<domain>/<skill-name>/`
2. Add `skill.yaml` with all required fields (validate against `skillManifestFileSchema`)
3. Add at least one stage markdown file (`intent.md`, `draft.md`, etc.) — required for auto-discovery
4. For structure-type skills with interactive drafts, add `handler.ts` implementing `SkillHandler`
5. Add tests in `<skill-dir>/__tests__/`

Skills are auto-discovered by the `AgentSkillLoader` — no manual registration is needed.

### Skill Loading Flow

1. `AgentSkillLoader` scans `agent-skills/` recursively for `skill.yaml` files
2. Manifests validated via Zod (`skillManifestFileSchema`)
3. Stage markdown loaded and bundled per skill ID
4. Handler modules dynamically imported from `handler.ts`/`handler.js`
5. `AgentSkillRegistry` resolves plugins by `skillId` or `structureType` at runtime
6. `AgentSkillRuntime` orchestrates: detect type → extract params → build model → execute tools

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
