# Extraction Map from Existing Code

## Category 1: Structure Modeling Skills
Source now:
- backend/src/agent-skills/beam
- backend/src/agent-skills/double-span-beam
- backend/src/agent-skills/frame
- backend/src/agent-skills/portal-frame
- backend/src/agent-skills/truss

## Category 2: Material and Constitutive Skills
Source now:
- backend/src/services/agent-skills/domains/material-analysis.ts

## Category 3: Geometry Input Skills
Source candidates now:
- geometry-related extraction in structure handlers under backend/src/agent-skills/*/handler.ts
- generic draft assembly path in backend/src/services/agent.ts

## Category 4: Load and Boundary Skills
Source candidates now:
- load and support parsing in structure handlers under backend/src/agent-skills/*/handler.ts
- load normalization in backend/src/services/agent.ts

## Category 5: Analysis Strategy Skills
Source now:
- policy and defaults in backend/src/services/agent-policy.ts
- analysis strategy helpers in backend/src/services/agent-skills/domains/material-analysis.ts

## Category 6: Code-Check Skills
Source now:
- backend/src/services/agent-skills/domains/code-check-domain.ts
- code-check call path in backend/src/services/agent.ts

## Category 7: Result Postprocess Skills
Source now:
- backend/src/services/agent-skills/domains/postprocess-domain.ts

## Category 8: Visualization Skills
Source now:
- backend/src/services/agent-skills/domains/visualization-domain.ts

## Category 9: Report and Export Skills
Source now:
- backend/src/services/agent-skills/report-template.ts
- report generation and artifact persistence path in backend/src/services/agent.ts

## Category 10: Generic Fallback Skills
Source now:
- backend/src/services/agent-noskill-runtime.ts
- no-skill orchestration path in backend/src/services/agent.ts

Rule:
- category 10 is enhancement-only; baseline fallback remains in core runtime.
