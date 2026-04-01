# Skill Loading Mechanism

## 1. Overview

StructureClaw skills are modular, detachable plugins that extend the agent's structural engineering capabilities. The system supports two skill sources:

- **Builtin skills** — shipped with the codebase, discovered at startup from the filesystem.
- **External / SkillHub skills** — installed from the SkillHub marketplace at runtime.

The system is designed around a **base-chat fallback principle**: when zero engineering skills are loaded, the agent remains available as a normal conversational assistant, but it does not enter drafting, analysis, or code-check execution.

## 2. Builtin Skill Discovery and Registration

### 2.1 Analysis Skills

Analysis skills live under `backend/src/agent-skills/analysis/`. Each skill is a subdirectory containing:

| File | Required | Purpose |
|------|----------|---------|
| `intent.md` | Yes | Frontmatter metadata (id, software, analysisType, engineId, etc.) |
| `runtime.py` | Yes | Python execution script for the analysis engine |

**Discovery process** (`analysis/registry.ts`):

1. `discoverBuiltinAnalysisSkills()` scans all subdirectories under the analysis root.
2. Directories starting with `.` or named `runtime` are skipped.
3. For each directory, `toAnalysisSkillManifest()` checks for `intent.md` and `runtime.py`.
4. If either file is missing, a warning is logged and the directory is skipped.
5. `intent.md` frontmatter is parsed for required fields: `id`, `software`, `analysisType`, `engineId`, `adapterKey`.
6. Missing required fields trigger a warning with the specific field names.
7. Valid skills are sorted by priority (descending), then alphabetically by id.
8. A discovery summary is logged: `"N skills loaded, M skipped"`.

**Built-in analysis engines:**

| Engine ID | Adapter | Priority | Routing Hints |
|-----------|---------|----------|---------------|
| `builtin-opensees` | OpenSees | 100 | high-fidelity, default |
| `builtin-simplified` | Simplified | 10 | fallback, fast |

### 2.2 Structure-Type Skills

Structure-type skills live under `backend/src/agent-skills/structure-type/`. Each skill has a `manifest.ts` that exports the skill's metadata.

**Registration process** (`structure-type/registry.ts`):

1. `listStructureModelingProviders()` takes builtin plugins and optional external providers.
2. Plugins are converted to `StructureModelingProvider` via `toStructureModelingProvider()`.
3. All providers are passed to `loadSkillProviders()` for deduplication and sorting.

### 2.3 Other Skill Domains

| Domain | Location | Registration |
|--------|----------|-------------|
| `analysis` | `agent-skills/analysis/` | Filesystem discovery + manifest normalization |
| `code-check` | `agent-skills/code-check/` | Provider registry with filter/finalize callbacks |
| `data-input` | `agent-skills/data-input/` | Plugin manifest |
| `design` | `agent-skills/design/` | Plugin manifest |
| `drawing` | `agent-skills/drawing/` | Plugin manifest |
| `general` | `agent-skills/general/` | Plugin manifest |
| `load-boundary` | `agent-skills/load-boundary/` | Plugin manifest |
| `material` | `agent-skills/material/` | Plugin manifest |
| `visualization` | `agent-skills/visualization/` | Plugin manifest |
| `result-postprocess` | `agent-skills/result-postprocess/` | Plugin manifest |
| `report-export` | `agent-skills/report-export/` | Runtime-generated builtin manifest |
| `section` | `agent-skills/section/` | Plugin manifest |
| `validation` | `agent-skills/validation/` | Runtime-generated builtin manifest |

In the current implementation, `AgentSkillRuntime.listSkillManifests()` exposes a unified manifest inventory by merging `structure-type` plugin manifests with a set of builtin domain manifests. The runtime-generated manifests currently cover:

- `analysis`
- `code-check`
- `report-export`
- `validation`

Builtin `structure-type` manifests now directly authorize modeling tools only:

- `draft_model`
- `update_model`

Execution-chain tools such as `validate_model`, `run_analysis`, `run_code_check`, and `generate_report` are no longer granted directly by `structure-type` manifests. They are authorized through the downstream domain manifests activated for the current turn.

Before entering the execution chain, the agent now derives the downstream domain skill set explicitly for the current turn:

- The `analysis` domain selects one preferred analysis skill based on `analysisType`, `engineId`, structural model family, and any explicit skill selection.
- The `code-check` domain selects one matching standard skill from `designCode`.
- `validation` and `report-export` are activated on demand through builtin domain manifests.

In the current implementation, the actual `validation`, `analysis`, `code-check`, and `report-export` execution entrypoints are wrapped by `AgentSkillRuntime`: the agent no longer assembles those domain registries or report-domain details directly, and the selected downstream skill id is written back into result `meta` and tool-trace attribution.

The current `/api/v1/agent/capability-matrix` also exposes `runtimeStatus` for each skill and each domain summary so the stable taxonomy can be distinguished from actual runtime wiring:

- `active`: participates in main orchestration, activation, authorization, execution, and trace.
- `partial`: connected to runtime, but still platform-managed or not yet packaged as a full first-class skill.
- `discoverable`: present in the taxonomy, but not yet part of the main orchestration flow.
- `reserved`: kept as an architectural slot without current runtime capability.

## 3. External / SkillHub Skill Packaging and Loading

### 3.1 Package Metadata

Every skill (builtin or external) is represented by `SkillPackageMetadata`:

```typescript
interface SkillPackageMetadata {
  id: string;                    // Unique identifier
  domain: SkillDomain;           // e.g., 'structure-type', 'code-check'
  version: string;               // Semver string, e.g., '1.0.0'
  source: 'builtin' | 'skillhub';
  capabilities: string[];
  compatibility: {
    minRuntimeVersion: string;   // Minimum runtime version required
    skillApiVersion: string;     // Must match exactly, e.g., 'v1'
  };
  entrypoints: {                 // Module entry paths by key
    [key: string]: string | undefined;
  };
  enabledByDefault: boolean;
  priority?: number;
  requires?: string[];           // Skill IDs that must also be loaded
  conflicts?: string[];          // Skill IDs that cannot coexist
  supportedLocales?: string[];
  supportedAnalysisTypes?: string[];
  materialFamilies?: string[];
}
```

### 3.2 Loading Pipeline

External skills are loaded through `loadExecutableSkillProviders()`, a three-stage pipeline:

```
entrypoint → import → validate
```

| Stage | Check | Failure Reason |
|-------|-------|----------------|
| **Entrypoint** | `entrypoints[key]` exists in package metadata | `missing_entrypoint` |
| **Import** | `importModule(specifier, pkg)` succeeds | `import_failed` |
| **Validate** | `validateModule(module, pkg)` returns no errors | `invalid_provider` |

Each failure is recorded with the package ID, version, domain, source, stage, reason, and optional detail string.

### 3.3 SkillHub Lifecycle

Skills from SkillHub follow this lifecycle managed by `AgentSkillHubService`:

```
search → install → enable ↔ disable → uninstall
```

- **Search**: Queries the catalog, evaluates compatibility and integrity for each entry.
- **Install**: Validates integrity (checksum + signature), evaluates compatibility, records to `installed.json`.
- **Enable/Disable**: Toggles the `enabled` flag in the installed state.
- **Uninstall**: Removes the skill record from the installed state.

Installed state is persisted at `.runtime/skillhub/installed.json`.

## 4. Metadata, Versioning, Dependency, and Compatibility

### 4.1 Version Compatibility

Compatibility is evaluated by `evaluateSkillCompatibility()` in `skill-shared/loader.ts`:

| Field | Comparison | Rule |
|-------|-----------|------|
| `minRuntimeVersion` | Semver numeric comparison | Skill requires runtime ≥ this version |
| `skillApiVersion` | Exact string match | Must match current API version exactly |

**Reason codes for incompatibility:**

- `runtime_version_incompatible` — the runtime version is older than the skill requires.
- `skill_api_version_incompatible` — the skill API version does not match.

Current defaults (overridable via environment variables):

- `SCLAW_RUNTIME_VERSION` → defaults to `'0.1.0'`
- `SCLAW_SKILL_API_VERSION` → defaults to `'v1'`

### 4.2 Dependency Resolution

Dependencies are resolved by `resolveSkillDependencies()` in `skill-shared/loader.ts`:

| Field | Semantics |
|-------|----------|
| `requires` | All listed skill IDs must be present in the loaded provider set |
| `conflicts` | None of the listed skill IDs may be present in the loaded provider set |

**Resolution rules:**

1. Providers without a matching package entry pass through unchanged.
2. Providers with unmet `requires` are rejected with reason `unmet_requires`.
3. Providers with active `conflicts` are rejected with reason `conflict_detected`.
4. Rejection never throws — the provider is silently excluded and the system continues.

### 4.3 Provider Loading Order

`loadSkillProviders()` processes providers in this order:

```
merge → filter → sort → deduplicate → resolve dependencies → finalize
```

1. **Merge**: Combine builtin and external providers into one list.
2. **Filter**: Apply optional filter callback to exclude providers.
3. **Sort**: By priority according to `priorityOrder` (**descending by default**), then builtin-before-skillhub, then alphabetical id.
4. **Deduplicate**: Keep the first occurrence of each provider ID in the sorted order (so the "winner" depends on `priorityOrder`; with the default `desc`, the highest priority wins).
5. **Resolve dependencies**: When a `packages` map is provided, check `requires`/`conflicts`.
6. **Finalize**: Apply optional post-processing callback.

## 5. Failure Handling and Fallback Behavior

### 5.1 External Skill Load Failures

Failures from `loadExecutableSkillProviders()` are structured and aggregatable:

```typescript
interface ExecutableSkillProviderLoadFailure {
  packageId: string;
  packageVersion: string;
  domain: string;
  source: string;
  stage: 'entrypoint' | 'import' | 'validate';
  reason: 'missing_entrypoint' | 'import_failed' | 'invalid_provider';
  detail?: string;
}
```

Use `summarizeSkillLoadResult()` to aggregate:

```typescript
interface SkillLoadSummary {
  loaded: number;
  failed: number;
  failuresByReason: Record<string, number>;
  failureDetails: Array<{ packageId: string; reason: string; detail?: string }>;
}
```

### 5.2 Incompatible Skill Handling

When a SkillHub skill fails compatibility evaluation during install:

- The skill is still recorded in `installed.json`.
- `compatibilityStatus` is set to `'incompatible'`.
- `incompatibilityReasons` lists the specific reason codes.
- The skill is **not auto-enabled**.
- `fallbackBehavior` is set to `'baseline_only'`.

### 5.3 Integrity Failure Handling

When a SkillHub skill fails integrity verification (checksum or signature mismatch):

- Installation is **rejected** entirely.
- `integrityStatus` is set to `'rejected'`.
- `fallbackBehavior` is set to `'baseline_only'`.

### 5.4 Zero-Skill Behavior

When zero skills are loaded (`skillIds` is an empty array), the system stays on the **base chat path**:

1. **Engineering session reset**: Skill-specific draft state, structural-type carry-over, and cached engineering model state are cleared.
2. **Conversation-only response**: The agent can still clarify the user's needs in plain language.
3. **No implicit execution**: External tools such as `draft_model`, `run_analysis`, `run_code_check`, and `generate_report` are not callable until an enabled skill authorizes them.
4. If the caller forces tool execution while no skills are enabled, the request is blocked with `NO_EXECUTABLE_TOOL`.

### 5.5 Failure Strategy Summary

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| External skill entrypoint missing | Skipped, recorded as failure | Other skills still load |
| External skill import error | Skipped, error detail captured | Other skills still load |
| External skill validation failure | Skipped, validation errors recorded | Other skills still load |
| Dependency `requires` unmet | Provider excluded from loaded set | System continues without it |
| Dependency `conflicts` detected | Provider excluded from loaded set | System continues without it |
| Version incompatible | Installed but not enabled | Visible in installed list |
| Integrity check failed | Installation rejected | Not recorded as installed |
| All skills unavailable | Stay on base chat path | Conversation remains available, but engineering execution is blocked |

## 6. Related Files

| File | Purpose |
|------|---------|
| `backend/src/skill-shared/loader.ts` | Core loading, sorting, dedup, dependency, compatibility |
| `backend/src/skill-shared/package.ts` | SkillPackageMetadata definition and normalization |
| `backend/src/skill-shared/provider.ts` | BaseSkillProvider interface |
| `backend/src/agent-skills/analysis/registry.ts` | Analysis skill filesystem discovery |
| `backend/src/agent-skills/structure-type/registry.ts` | Structure-type provider registry |
| `backend/src/services/agent-skillhub.ts` | SkillHub install/enable/disable/uninstall service |
