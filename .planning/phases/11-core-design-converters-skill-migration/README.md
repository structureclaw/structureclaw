# Core Design/Converters to Backend Skill Migration

## Objective
- Migrate Python implementation ownership of `core/design` and `core/converters` into `backend/src/agent-skills` aligned domain folders.
- Keep core runtime API stable via compatibility bridge so existing imports and contracts remain valid.

## Scope
- `core/design/*.py` -> `backend/src/agent-skills/material-constitutive/*.py` and `backend/src/agent-skills/code-check/code_check.py`
- `core/converters/*.py` -> `backend/src/agent-skills/geometry-input/converters/*.py`

## Mapping
- `core/design/steel.py` -> `backend/src/agent-skills/material-constitutive/steel.py`
- `core/design/concrete.py` -> `backend/src/agent-skills/material-constitutive/concrete.py`
- `core/design/code_check.py` -> `backend/src/agent-skills/code-check/code_check.py`
- `core/converters/*.py` -> `backend/src/agent-skills/geometry-input/converters/*.py`

## Compatibility Strategy
- Add a shared loader in `core/skill_bridge.py` to load migrated Python modules from backend skill paths.
- Keep `core/design` and `core/converters` as compatibility facades (same symbols, delegated implementations).
- Do not change API request/response contracts during this phase.

## Implementation Steps
1. Create backend target folders and copy source files.
2. Add core compatibility bridge.
3. Switch core symbols to re-export migrated implementations.
4. Run core import/startup sanity checks.

## Acceptance
- Core imports remain unchanged for callers.
- `/convert` and `/code-check` endpoints still import and run.
- Python syntax check passes for touched files.

## Validation Commands
- `python -m py_compile core/main.py core/skill_bridge.py core/design/steel.py core/design/concrete.py core/design/code_check.py core/converters/*.py`
- Optional: `./scripts/validate-analyze-contract.sh`
- Optional: `./scripts/validate-converter-api-contract.sh`

## Current Status
- [x] Plan created
- [x] Backend skill folders created
- [x] Python source copied to backend skill folders
- [x] Core compatibility bridge wired
- [x] Syntax sanity checks completed (`py_compile`)
- [ ] Runtime import check completed (blocked locally: missing numpy in current shell)

## Follow-up Progress (Code-Check Skill Split)
- [x] One-standard-one-skill folder layout completed for `code-check` (`gb50010`, `gb50011`, `gb50017`, `jgj3`, `custom`)
- [x] Frontend-visible markdown skill entries added per standard
- [x] Agent runtime skill selection now maps selected `code-check-*` skill IDs to `designCode`
- [x] Rule metadata moved into per-standard `rule.ts` files; `registry.ts` now only aggregates rules
- [x] `core/design/code_check.py` reduced to compatibility facade (no local fallback business implementation)
- [x] Backend build and targeted routing tests pass after refactor
