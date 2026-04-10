# Structure Type Skills

> Manifest-first note
>
> Builtin structure-type skills now define their canonical metadata in `skill.yaml`. Stage Markdown files
> remain content assets, and `handler.ts` remains the execution-layer entrypoint.

Purpose:
- Structure-type intent detection
- Structure-specific parameter extraction
- Structure model assembly helpers

Initial migration targets:
- beam
- double-span-beam
- frame
- portal-frame
- truss

Testing conventions:
- Ordinary skill tests live next to the skill under `backend/src/agent-skills/**/__tests__/`.
- These colocated tests must stay deterministic. They can use `llm = null` or stubbed responses, but they must not call a real external LLM provider.
- Real provider-backed skill cases live next to the skill under `backend/src/agent-skills/**/__llm_tests__/`.
- The repo-root `tests/llm-integration/` folder only keeps shared runner/helpers plus fixture discovery.
- New real LLM fixtures should use the v2 `family + scenarios + variants` shape so each scenario can declare explicit `enabledSkillIds`, `fallbackPolicy`, and `expect`.
- Legacy v1 fixtures with top-level `skillId` and `testCases[]` are still supported, but new coverage should use v2.
- Targeted runs can filter by family, variant, and scenario, for example `node tests/runner.mjs llm-integration --family frame --variant specific`.
