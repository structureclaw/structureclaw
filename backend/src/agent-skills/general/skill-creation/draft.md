# Skill Creation Guide

## Directory structure

Create under `backend/src/agent-skills/<domain>/<skill-name>/`:

```
<skill-name>/
├── skill.yaml          # Required — skill manifest
├── intent.md           # At least one stage markdown is required
├── draft.md            # Optional
├── analysis.md         # Optional
├── design.md           # Optional
├── handler.ts          # Optional — for interactive skills with custom logic
└── __tests__/          # Optional — tests for handler
    └── handler.test.mjs
```

## skill.yaml template

```yaml
id: <unique-skill-id>
domain: <domain-name>
source: builtin
name:
  zh: <中文名称>
  en: <English Name>
description:
  zh: <中文描述>
  en: <English description>
triggers:
  - <keyword1>
  - <keyword2>
stages:
  - intent
  - draft
structureType: unknown          # or beam, truss, frame, portal-frame
structuralTypeKeys: []          # e.g. ["beam", "梁"]
capabilities:
  - <capability-name>
requires: []
conflicts: []
priority: 50                    # 0-100, higher = preferred when multiple match
compatibility:
  minRuntimeVersion: 0.1.0
  skillApiVersion: v1
supportedAnalysisTypes: []
supportedModelFamilies: []
materialFamilies: []
aliases: []
toolHints: {}
runtimeContract:
  role: assistant
```

## handler.ts template (optional)

For skills that need custom draft extraction, state merging, or model building:

```typescript
import type { SkillHandler } from '../../agent-runtime/types';

export const handler: SkillHandler = {
  detectStructuralType(input) {
    // Return StructuralTypeMatch if user text matches this skill
    return null;
  },

  extractDraft(input) {
    // Extract parameters from user message + LLM output
    return { parameters: {}, confidence: 0 };
  },

  mergeState(existing, patch) {
    // Immutable merge of draft state
    return { ...existing, ...patch };
  },

  computeMissing(state, phase) {
    // Return which fields are still needed
    return { critical: [], optional: [] };
  },

  mapLabels(keys, locale) {
    // Localize field names for display
    return keys;
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    // Generate questions to ask the user
    return [];
  },

  buildModel(state) {
    // Build the final computable model JSON
    return undefined;
  },
};
```

## Validation rules

1. `skill.yaml` is required and must pass `skillManifestFileSchema` (Zod validation)
2. At least one stage `.md` file is required for auto-discovery
3. Skill IDs must be unique across all domains
4. `domain` must be one of the 14 recognized domains
5. `structureType` must match a known type or be `unknown`
6. Priority range: 0–100 (default 50)

## Best practices

- Keep stage markdown focused and under 200 lines each
- Use deterministic `handler.ts` methods when possible — avoid LLM calls in handlers
- Reference the `beam` skill (`backend/src/agent-skills/structure-type/beam/`) as a canonical example of a full skill with handler
- Reference the `memory` skill (`backend/src/agent-skills/general/memory/`) as a minimal skill example (yaml + intent.md only)
- Skills are auto-discovered by `AgentSkillLoader` — no manual registration needed
