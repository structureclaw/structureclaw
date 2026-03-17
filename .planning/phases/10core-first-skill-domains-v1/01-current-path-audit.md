# Current Path Audit

## Verified Baseline Core Path
- Entry orchestration is in backend/src/services/agent.ts.
- No-skill draft runtime is in backend/src/services/agent-noskill-runtime.ts.
- Core can already do generic model generation and engine execution in no-skill mode.

## Current Mixed Coupling Points
- Code-check domain helper is in backend/src/services/agent-skills/domains/code-check-domain.ts and is invoked directly by core orchestration.
- Postprocess logic is in backend/src/services/agent-skills/domains/postprocess-domain.ts and is invoked directly by report generation flow.
- Visualization hints are in backend/src/services/agent-skills/domains/visualization-domain.ts and are also used directly in core report flow.
- Skill routing and scenario detection are in backend/src/services/agent-skills/index.ts and backend/src/services/agent-skills/registry.ts.

## Current Skill Inventory
- In-repo structure skills: beam, double-span-beam, frame, portal-frame, truss.
- These are currently all domain=structure-type.
- Non-structure categories are not fully packaged as standalone skill plugins yet.

## Gap vs Target
- Core baseline exists but still imports some domain helpers from skill namespace.
- Most non-modeling capabilities are helper modules, not independently loadable domain skills.
- Folder layout only partially reflects domain taxonomy.
