# Migration Roadmap

## Phase A - Protect baseline core first
- Freeze core-first contract tests for no-skill mode.
- Validate end-to-end path: text -> model -> validate -> analyze without any skill.
- Enforce fallback policy: unmatched skill -> generic LLM model generation.

Exit criteria:
- skillIds=[] can reach analysis success or deterministic missing-parameter clarification.
- No template preselection prompt required in baseline path.

## Phase B - Domain folder migration (structure modeling first)
- Move existing beam/frame/truss plugins into structure-modeling category folders.
- Keep compatibility by enabling dual path scanning in loader.
- Keep behavior identical while only changing folder placement.

Exit criteria:
- Existing modeling tests unchanged and green.

## Phase C - Extract non-modeling domains from current core helpers
- Material and constitutive domain: extract material-analysis defaults and policies.
- Geometry input domain: extract geometry-only parsing and completion logic.
- Load and boundary domain: extract load/boundary parsing and checks.
- Analysis strategy domain: extract analysis type and policy selection.
- Code-check domain: convert code-check helper into skill plugin entry.
- Result postprocess domain: convert metric and traceability helper into plugin entry.
- Visualization domain: convert visualization hint logic into plugin entry.
- Report/export domain: convert report narrative and export shaping into plugin entry.

Exit criteria:
- Each domain can be enabled/disabled independently.
- Core still works with zero domain skills loaded.

## Phase D - Generic fallback skill hardening
- Keep core generic LLM fallback always enabled.
- Add optional generic-fallback skill for guided clarification quality only.
- Generic-fallback skill must never become a hard dependency.

Exit criteria:
- Turning generic-fallback skill off still keeps core baseline functioning.

## Phase E - Cleanup and strict boundaries
- Remove deprecated flat folder assumptions.
- Add static checks to prevent domain-specific templates leaking back into core.

Exit criteria:
- Core file set has no structure-template branching.
- Domain ownership is explicit and test-covered.
