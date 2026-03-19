# Phase 12 Class Status: Code Check

Updated: 2026-03-19
Owner: backend-agent

## Checklist
- [x] `code-check` selected as the first Phase 12 class migration
- [x] Class-level plan created
- [x] Current-state registry behavior documented
- [x] Class target defined: built-in + external provider registry
- [x] Product direction recorded: design standard should move out of analysis settings and into code-check skill selection
- [x] `CodeCheckRuleProvider` type added in backend code
- [x] Built-in rule registry migrated to provider registry
- [x] External provider loading seam added
- [x] Design-code resolution moved to merged provider ordering
- [x] Regression tests added for ordering/unknown-standard-failure/merge behavior
- [x] Backend validation commands re-run after implementation
- [x] Analysis settings design-code field removed from target UI flow
- [x] Backend execution no longer defaults to `GB50017` when no code-check skill is selected
- [x] Policy/interaction flow no longer treats `designCode` as a generic analysis parameter
- [x] End-to-end code-check execution driven by selected code-check skills only

## Work Package Status
- [x] WP1 Define `code-check` Provider Types
- [x] WP2 Refactor Built-In Registry To Provider Registry
- [x] WP3 Add External Provider Loading Seam
- [x] WP4 Preserve Design-Code Resolution Semantics
- [x] WP5 Move Design Standard Ownership From Analysis Settings To Skills
- [x] WP6 Add Regression Coverage

## Current Notes
- Current implementation now uses a built-in provider registry with an explicit external-provider merge seam.
- External executable provider loading is not wired to SkillHub yet; the class seam exists and is covered by tests.
- Existing ordering semantics are preserved, and unsupported standards now fail explicitly instead of falling through to a hidden passthrough rule.
- Frontend analysis settings no longer expose `designCode` as a standalone field.
- Backend no longer silently defaults to `GB50017`; code-check only runs when a selected skill or a compatibility-bridge `designCode` is present.
- Legacy raw `designCode` input remains accepted as a compatibility bridge for older callers and future `custom` handling.
- This class should establish the provider-registry pattern that later classes can adapt to their own contracts.

## Validation Snapshot
- [x] `npm run build --prefix backend`
- [x] `npm test --prefix backend -- --runInBand backend/tests/code-check.skill-routing.test.mjs`
- [x] `npm test --prefix backend -- --runInBand backend/tests/agent.service.test.mjs backend/tests/code-check.skill-routing.test.mjs`
- [x] `npm run type-check --prefix frontend`
- [x] `npm run test:run --prefix frontend -- tests/integration/console-page.test.tsx -t "sends autoCodeCheck=true during execute when a code-check skill is selected"`
- [x] `npm run test:run --prefix frontend -- tests/integration/console-page.test.tsx -t "sends autoCodeCheck=false during execute when no code-check skill is selected"`
- [x] `npm run test:run --prefix frontend -- tests/integration/console-page.test.tsx`

## Exit Gate
- [x] class provider contract exists in backend code
- [x] built-in code-check rules are exposed through provider metadata
- [x] registry can merge built-in and external providers
- [x] current built-in behavior remains backward compatible
- [x] ordering and unknown-standard failure are regression-tested
- [x] design-standard selection belongs to code-check skill selection rather than analysis settings
- [x] backend does not silently default to `GB50017` when no code-check skill is selected

Gate status: provider-registry and product-flow migration complete; external SkillHub execution and final end-to-end cleanup pending.
