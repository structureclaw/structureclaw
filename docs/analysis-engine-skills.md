# Analysis Engine Skills

StructureClaw now exposes analysis engines as a pluggable execution layer.

## Current model
- Builtin engines are registered inside `core`.
- Installed engines are loaded from the manifest file referenced by `ANALYSIS_ENGINE_MANIFEST_PATH`.
- The default manifest path is `.runtime/analysis-engines.json` at the repo root.

## Supported engine kinds
- `python`
  - Must reference a whitelisted builtin `adapterKey`
  - Current whitelist: `builtin-opensees`, `builtin-simplified`
- `http`
  - Must provide `baseUrl`
  - May provide `authTokenEnv` and `timeoutMs`

## Manifest shape
```json
{
  "engines": [
    {
      "id": "partner-http-engine",
      "name": "Partner HTTP Engine",
      "version": "1.0.0",
      "kind": "http",
      "capabilities": ["analyze", "validate", "code-check"],
      "supportedAnalysisTypes": ["static", "dynamic"],
      "supportedModelFamilies": ["frame", "truss"],
      "priority": 60,
      "routingHints": ["partner", "regional"],
      "enabled": true,
      "baseUrl": "http://localhost:30111",
      "authTokenEnv": "PARTNER_ENGINE_TOKEN",
      "timeoutMs": 300000,
      "constraints": {},
      "installedSource": "api"
    }
  ]
}
```

## Request contract
- `core /analyze`, `/validate`, `/code-check` accept optional `engineId`
- Omit `engineId` to keep automatic routing
- Result `meta` includes:
  - `engineId`
  - `engineName`
  - `engineVersion`
  - `engineKind`
  - `selectionMode`
  - `fallbackFrom`
  - `timestamp`

## Backend management API
- `GET /api/v1/analysis-engines`
- `GET /api/v1/analysis-engines/:id`
- `POST /api/v1/analysis-engines/install`
- `POST /api/v1/analysis-engines/:id/enable`
- `POST /api/v1/analysis-engines/:id/disable`

## Agent capability matrix API
- `GET /api/v1/agent/capability-matrix`

### Query parameters
- `analysisType` (optional): `static | dynamic | seismic | nonlinear`
- When provided, the matrix applies analysis-type filtering and reason-code evaluation for the requested analysis type.

### Response highlights
- `skills`: loaded skill summaries (`id`, `structureType`, `stages`, localized `name`)
- `engines`: engine summaries (`id`, status flags, supported analysis/model families)
- `validEngineIdsBySkill`: engine IDs that are currently selectable for each skill
- `filteredEngineReasonsBySkill`: per-skill map of filtered engine IDs and reason codes
- `validSkillIdsByEngine`: reverse compatibility map for UI/reference use

### Current reason codes
- `engine_disabled`: engine is disabled in manifest/runtime status
- `engine_unavailable`: engine availability check indicates unavailable
- `engine_status_unavailable`: engine status is `disabled` or `unavailable`
- `model_family_mismatch`: engine model families do not satisfy the selected skill family
- `analysis_type_mismatch`: engine supported analysis types do not include the requested `analysisType`

### Notes
- `validEngineIdsBySkill` only includes engines passing all compatibility checks.
- `filteredEngineReasonsBySkill` is designed for frontend explainability and can contain multiple reason codes per engine.
