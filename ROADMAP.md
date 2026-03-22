# StructureClaw Roadmap

## Vision

StructureClaw is evolving from a working AI-assisted structural engineering monorepo into a more explicit engineering platform with three durable pillars:

- A skill-driven orchestration layer that can turn engineering intent into repeatable design, analysis, code-check, reporting, and visualization workflows.
- A stable and extensible structural model contract that can bridge user intent, built-in skills, external SkillHub packages, and downstream analysis engines.
- A cross-platform operator and developer experience that is easier to install, validate, document, and maintain across Windows, Linux, macOS, and Docker.

This roadmap focuses on turning the current foundation into a clearer platform without losing the deterministic regression and bilingual product principles already established in the repository. The immediate priority is the skill split and runtime boundary refactor; multi-platform unification should continue incrementally, and broad documentation refreshes should follow after the architecture stabilizes.

## Current State

StructureClaw already has a substantial foundation in place:

- A monorepo architecture with `frontend`, `backend`, `scripts`, and `docs`, with analysis hosted inside backend skills.
- A primary orchestration flow from draft model generation to `validate -> analyze -> code-check -> report`.
- Backend agent capabilities exposed through `POST /api/v1/agent/run` and chat endpoints under `POST /api/v1/chat/*`.
- Backend-hosted analysis capabilities exposed through `POST /validate`, `POST /convert`, `POST /analyze`, and `POST /code-check`.
- An existing built-in skill foundation under `backend/src/agent-skills`, including structure modeling, geometry input, load/boundary, material, analysis strategy, code-check, report export, result postprocess, visualization, runtime, and generic fallback layers.
- Existing SkillHub-facing APIs and validation scripts for agent orchestration, chat streaming, report contracts, skill contracts, converter contracts, and regression checks.
- A local-first workflow through `make` plus a growing unified CLI direction via `sclaw` and `scripts/claw.sh`.
- A bilingual documentation and user-visible content standard across English and Chinese materials.

The roadmap below therefore emphasizes systematizing and extending these capabilities rather than reintroducing them as net-new ideas.

## Now

### Skill Architecture and Runtime Boundaries

- Make skill taxonomy and skill boundary refactoring the top repository priority.
- Continue deepening the backend-hosted structural analysis runtime under `backend/src/agent-skills`, especially OpenSeesPy-oriented capabilities that behave more like platform skills than isolated engine internals.
- Clarify the functional boundaries of built-in skills across the end-to-end engineering chain: design, calculation, code-check, report export, and visualization.
- Formalize the split between built-in skills and external SkillHub packages so that loading, registration, capability discovery, fallback behavior, and lifecycle expectations are easier to reason about.
- Tighten the runtime contract for skills so new skills can be added without weakening the existing no-skill fallback path.

### Structural Model and Interchange Contract

- Define a clearer v1 structural calculation JSON baseline that remains compatible with the current `StructureModel` contract while accommodating the practical parameter shape expected by major engineering tools such as YJK and PKPM.
- Preserve extension points so future converters and engine adapters can target the same shared model without locking the repository into one solver-specific schema too early.
- Add explicit governance around validation expectations, schema evolution, and engine-specific conversion boundaries.

### Platform Groundwork

- Keep the current public interfaces stable while the internal skill and runtime contracts are restructured.
- Preserve existing regression coverage for agent orchestration, chat stream behavior, analyze/code-check/report flows, and structure validation during the refactor.
- Treat other platform improvements as supporting work only when they unblock or reduce risk for the skill refactor.

## Next

### Unified Multi-Platform Entry

- Continue consolidating the fragmented startup and operational entrypoints around `sclaw`, but do so incrementally so the CLI work does not block the skill refactor.
- Introduce `sclaw_cn` as a Simplified Chinese distribution-oriented variant with China-friendly mirrors and onboarding defaults when the base CLI surface is stable enough to absorb it cleanly.
- Gradually absorb commonly used flows from `make.*`, `scripts/`, and Windows helper scripts into the unified CLI while keeping Docker as a supported deployment path throughout the transition.
- Ensure Docker lifecycle flows, including Windows-oriented install/start/stop scenarios, are represented through the unified command surface over time rather than requiring a single large migration.

### Developer Experience and Validation

- Reduce script sprawl by keeping focused validators while moving repeated operational behavior into the CLI surface.
- Make install, startup, health, regression, and environment diagnostics easier to run consistently across local native and Docker-based setups.
- Keep `StructureModel v1`, `POST /api/v1/agent/run`, `POST /api/v1/chat/*`, `POST /validate`, `POST /convert`, `POST /analyze`, and `POST /code-check` semantically stable while surrounding tooling improves.

## Later

### Skill Ecosystem Expansion

- Expand the skill taxonomy to cover richer data ingestion flows such as CAD conversion, Revit conversion, BIM import, image-to-model, and PDF extraction variants.
- Add structure-type-oriented skills for common engineering scenarios such as shear wall, frame, frame-shear wall, special structures, and transmission towers.
- Extend material, section, load/boundary, validation, calculation, postprocess, code-check, report, drawing, visualization, and general runtime utility skills into a more complete engineering capability matrix.
- Continue building out code-check coverage around Chinese standards such as GB and JGJ families without forcing a single monolithic implementation model.

### Quality, Coverage, and Documentation

- Increase unit, integration, and runner-level automated coverage across backend, frontend, CLI, and orchestration surfaces.
- Add installation and startup verification for Windows and Linux in both native and Docker modes.
- Refresh the documentation set, including `README.md`, `README_CN.md`, `docs/handbook.md`, `docs/handbook_CN.md`, `docs/reference.md`, and `docs/reference_CN.md`, after the skill architecture and CLI direction are stable enough to document without churn.
- Synchronize the repository documentation direction with the GitHub wiki.
- Remove outdated documents such as `docs/windows-wsl2-setup.md` once replacement guidance is in place.

### Project Operations

- Establish clearer issue, pull request, and discussion triage practices so roadmap execution remains visible and reviewable as the repository grows.

## Cross-Cutting Quality Gates

The following principles apply throughout all roadmap phases:

- New user-visible workflows, generated content, prompts, reports, empty states, and guidance must remain bilingual in English and Chinese.
- Skill growth must not break the existing no-skill fallback model.
- Structural JSON evolution must remain regression-friendly and deterministic enough for scripted validation.
- Contract coverage for agent orchestration, chat streaming, analyze, code-check, report generation, and converter behavior must remain part of the acceptance criteria for major changes.
- Windows, Linux, and Docker usage paths must be treated as first-class validation targets, not afterthoughts.
- Documentation changes should track architecture and workflow changes closely enough that the handbook and reference remain trustworthy operational sources.
