# P08 Surgery Plan - Core Minimal, Skill Owned

## Objective
- Make `backend/src/services/agent.ts` a thin generic orchestrator.
- Move structure-template matching, template defaults, template-specific extraction, and template-specific clarification out of core.
- Keep no-skill path generic, schema-driven, and computability-first.

## Non-Negotiable Boundary
- Core owns only:
  - session lifecycle,
  - route/protocol orchestration,
  - generic draft extraction interface,
  - generic missing-field evaluation,
  - generic model validation/execute/report pipeline,
  - persistence and telemetry.
- Skills own:
  - scenario keyword matching,
  - template-specific draft merge rules,
  - template-specific missing fields,
  - template-specific defaults and question phrasing,
  - template-specific model assembly.

## What Must Leave Core
- Any `inferredType` hard branch for `beam`, `truss`, `portal-frame`, `double-span-beam`, `frame` in no-skill path.
- Any template-enumeration question text or route hint text.
- Any template-specific fallback extraction logic that depends on keyword catalogs.

## Target Runtime Shape
- `agent.ts` calls one generic no-skill runtime surface and one skill runtime surface.
- No-skill runtime module (new):
  - `extractGenericDraft(...)`
  - `computeGenericMissing(...)`
  - `buildGenericModel(...)`
  - `buildGenericClarification(...)`
- Skill runtime remains template-aware and isolated under `backend/src/services/agent-skills/`.

## Function-Level Migration Map
- From `backend/src/services/agent.ts`:
  - `extractDraftByRules` -> split:
    - generic numeric/entity extraction stays in no-skill runtime,
    - template keyword mapping moves to skill handlers only.
  - `computeMissingFields` -> split:
    - no-skill generic missing checker in no-skill runtime,
    - template missing checker in skill handlers.
  - `buildModel` -> split:
    - no-skill generic model builder in no-skill runtime,
    - template model builders in skill handlers.
  - `extractLoadPosition` -> split:
    - generic offset extraction retained for no-skill,
    - template load-position semantics move to each template skill.

## PR Sequence (Small but Strict)

### PR-S1: Introduce Generic No-Skill Runtime
- Add `backend/src/services/agent-noskill-runtime.ts`.
- Move no-skill-only logic from `agent.ts` into the new runtime.
- Keep behavior unchanged.
- Exit criteria:
  - build green,
  - existing no-skill tests green.

### PR-S2: Remove Template Branching From No-Skill Path
- Delete no-skill dependency on template branches.
- No-skill computability checks must be schema-based only.
- Exit criteria:
  - complete no-skill inputs return `ready` directly,
  - clarification asks missing schema fields only.

### PR-S3: Migrate Remaining Template Logic To Skill Handlers
- Move any remaining template-specific labels/questions/defaults from core to skill handlers.
- Add per-skill extraction ownership for template-specific cues.
- Exit criteria:
  - no template label constants remain in core.

### PR-S4: Contract Hardening
- Add `scripts/validate-no-skill-fallback-contract.sh`.
- Contract cases:
  - no-skill complete request -> `ready` + `model`.
  - no-skill incomplete request -> missing-schema clarification only.
  - no-skill route does not emit template recommendation text.
  - skill-enabled request keeps template behavior unchanged.

### PR-S5: Telemetry and Debug Traceability
- Add reason codes:
  - `generic_model_ready`,
  - `generic_missing_fields`,
  - `skill_template_route`.
- Surface source in metadata/debug panel.
- Exit criteria:
  - debug details include modeling source and reason code.

### PR-S6: Dead Code Removal and Guard Rails
- Remove obsolete core template helpers.
- Add regression guard to fail if new template string list appears in core no-skill flow.
- Exit criteria:
  - static grep check in CI for forbidden template literals in core no-skill functions.

## Acceptance Checklist
- Core no-skill flow has no template list in prompts/questions.
- Core no-skill flow can build model from generic geometry/load inputs without skill selection.
- Skill-enabled flows keep existing scenario quality.
- All relevant backend tests and contract scripts pass.

## Validation Matrix
- `npm run build --prefix backend`
- `npm test --prefix backend -- backend/tests/agent.service.test.mjs --runInBand`
- `./scripts/validate-agent-orchestration.sh`
- `./scripts/validate-chat-message-routing.sh`
- `./scripts/validate-no-skill-fallback-contract.sh` (new)

## Rollback Strategy
- Each PR remains behavior-compatible and reversible.
- Keep feature flags optional for transition if a regression appears:
  - `AGENT_NOSKILL_GENERIC_ONLY=true` (default target),
  - temporary fallback toggle for emergency rollback during migration.

## Risks and Mitigations
- Risk: skill-enabled quality regressions while extracting shared helpers.
  - Mitigation: keep skill path tests unchanged and run targeted skill regression each PR.
- Risk: no-skill generic model becomes too simplistic.
  - Mitigation: enforce computability-first baseline plus iterative enhancement in dedicated runtime.
- Risk: duplicated logic between no-skill runtime and skill handlers.
  - Mitigation: share only neutral utilities (number parsing, JSON extraction), keep domain logic separated.
