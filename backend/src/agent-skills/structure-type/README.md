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
- Real provider-backed skill tests live under `tests/llm-integration/` at the repo root.
- Every real LLM fixture must declare `skillId`, so tests can be filtered per skill with `node tests/runner.mjs llm-integration --skill <skillId>`.
