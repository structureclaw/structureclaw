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
