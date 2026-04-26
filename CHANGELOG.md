# Changelog

All notable changes to StructureClaw are documented in this file.

## [1.0.0] - 2026-04-27

### Added — npm Packaging & Distribution

- npm package publication: `npm install -g structureclaw` for instant setup
- Single-process architecture: backend serves frontend static assets via `@fastify/static`
- Frontend static export (`output: 'export'`) for zero-dependency frontend deployment
- Runtime data directory: user data stored in `~/.structureclaw/` (not in package dir)
- Interactive first-run wizard: `sclaw doctor` prompts for LLM configuration
- LLM connectivity test in `sclaw doctor` (non-blocking)
- `.runtime/` → `~/.structureclaw/` migration for existing users
- Dual-mode CLI: works in both source checkout (dev) and installed package (production)
- Thin bin shims with Node.js version validation
- Postinstall script for automatic Prisma client generation
- Packaging script (`prepublishOnly`) for assembling `dist/` artifacts
- GitHub Actions workflow for automated npm publishing on release
- Browser auto-open after `sclaw start` in installed mode

### Added — Structured Logging (#164)

- Structured logging with configurable verbosity via `LOG_LEVEL` env var
- LLM call logging (`LLM_LOG_ENABLED`, `LLM_LOG_DIR`) for prompt/response auditing
- Log rotation for application and LLM logs
- Pino logger with pretty-print transport for development

### Added — LangGraph Agent (#156)

- LangGraph.js ReAct agent replacing deterministic pipeline
- Capability-driven agent orchestration with skill/tool layers
- 14 skill domains under `backend/src/agent-skills/`
- File-based checkpointer for LangGraph state persistence
- Streaming progress with tool step visibility

### Added — Frontend Console

- ChatGPT-style UI with streaming message bubbles
- Markdown and LaTeX rendering in chat messages
- Interactive 3D visualization with Three.js (grid, planes, structure models)
- Agent tool step display with expand/collapse output
- Tool status and progress indicators
- Analysis engine status display and probe verification
- Global LLM settings dialog (base URL, model, API key)
- Database management dialog
- Accessibility enhancements — keyboard navigation, reduced motion, screen reader support
- Responsive layout for low-resolution screens
- Dark/light theme with toggle

### Added — Agent Skills & Tools

- Skill pipeline scheduler with runtime contracts
- Structure-type skills: beam, frame, portal-frame with modular extraction pipelines
- Analysis skills: OpenSees integration for static and simplified analysis
- Code-check skills: GB50017, GB50009, GB50010, GB50011, JGJ3 with real computation
- Load/boundary condition skill with LLM extraction
- Section skills with modular bridge/irregular patterns
- Visualization skill hub entries
- Drafting skill definitions for drawing generation workflows
- Material skill domain
- Data-input skill domain

### Added — Analysis Engines

- YJK (盈建科) model import and conversion
- PKPM SATWE calculation report export and analysis
- StructureModel V2 with section shapes, openings, per-element grades
- Structural coordinate migration to global-z-up convention
- JSONL-based full LLM prompt/response logging

### Added — Testing & CI

- LLM integration test suite with skill-aware architecture and colocated fixtures
- E2E test suite via Playwright
- Backend Jest coverage for agent orchestration, tools, and skills
- Regression test runner (`node tests/runner.mjs`)
- Backend regression workflow (build + lint + Jest + validations)
- Analysis regression with deterministic OpenSees fixtures
- Agent orchestration, chat stream, and analyze endpoint contract validations
- CLI smoke tests (native and Docker)
- Comment-triggered `/test-llm` and `/test-e2e` CI workflows

### Changed

- Root `package.json` restructured for npm publication with hoisted dependencies
- `sclaw start` detects installed-package mode and runs single-process
- Backend config resolves paths to `~/.structureclaw/` in installed mode
- Frontend locale detection moved from SSR to client-side
- Strict analysis skill selection, removed engine selector UI
- Schema migrated from StructureModel V1 to V2 as canonical format
- Removed Redis dependency from local runtime (SQLite-only default)
- Removed legacy deterministic agent pipeline
- Prisma schema scoped to Conversation (removed User/Project entities)

### Fixed

- Frontend static export compatibility (removed `cookies()` SSR dependency)
- YJK multi-story assembly and fire-and-forget calculation
- PKPM SATWE modeling fixes for steel frame analysis
- PKPM SATWE internal force mapping and utilization cleanup
- Generic draft extraction, prompt trim, and full-frame model builder
- 3D visualization grid positioning on floor plane switch
- Tool step skillId restoration after page refresh
- Tool output full display and dialog dismiss behavior
- Memory tool workspace scope for cross-session persistence
