# Target Domain Layout

## New skill root layout
- backend/src/agent-skills/structure-modeling/
- backend/src/agent-skills/material-constitutive/
- backend/src/agent-skills/geometry-input/
- backend/src/agent-skills/load-boundary/
- backend/src/agent-skills/analysis-strategy/
- backend/src/agent-skills/code-check/
- backend/src/agent-skills/result-postprocess/
- backend/src/agent-skills/visualization/
- backend/src/agent-skills/report-export/
- backend/src/agent-skills/generic-fallback/

## Packaging rule
- Each concrete skill plugin stays in its own folder under one domain category.
- Each plugin carries: intent.md, draft.md, analysis.md, design.md, manifest.ts, handler.ts.
- Shared parser utils remain in backend/src/services/agent-skills only until domain libraries are fully extracted.

## Loader rule (migration-safe)
- During migration, loader must support both current flat skill folders and new domain folder nesting.
- After migration freeze, remove flat fallback scanning.

## Runtime rule
- Core pipeline remains schema-driven and engine-driven.
- Domain skills can enrich extraction, defaults, guidance, and post-processing.
- Unmatched request with no applicable skill: direct generic LLM model generation path.
