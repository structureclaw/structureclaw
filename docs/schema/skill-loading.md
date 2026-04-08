# Skill Loading Mechanism

## 1. Overview

StructureClaw skills are modular, detachable plugins that extend the agent's structural engineering capabilities. The system supports two skill sources:

- **Builtin skills** — shipped with the codebase, discovered at startup from the filesystem.
- **External / SkillHub skills** — installed from the SkillHub marketplace at runtime.

The system is designed around a **base-chat fallback principle**: when zero engineering skills are loaded, the agent remains available as a normal conversational assistant, but it does not enter drafting, analysis, or code-check execution.

## 2. Builtin Skill Discovery and Registration

### 2.1 Canonical Builtin Skill Layout

Builtin skills live under `backend/src/agent-skills/<domain>/<skill-id>/`.

Every builtin skill directory must contain:

| File | Required | Purpose |
|------|----------|---------|
| `skill.yaml` | Yes | Canonical static metadata: `id`, `domain`, `capabilities`, `grants`, compatibility, and domain-specific fields |
| Stage Markdown such as `intent.md`, `draft.md`, `analysis.md`, `design.md` | Optional but typical | Prompt/content assets loaded by the runtime |

Additional runtime files remain domain-specific, for example:

- analysis skills may include `runtime.py`
- executable structure-type plugins may include `handler.ts`

Those files are execution/content assets. They no longer define skill identity.

### 2.2 Discovery Rule

Builtin skill discovery is now manifest-first:

1. The runtime scans `backend/src/agent-skills/` recursively.
2. A directory is considered a builtin skill only if it contains `skill.yaml`.
3. `skill.yaml` is parsed through the shared manifest schema and becomes the static source of truth.
4. Stage Markdown files are loaded only as content; their frontmatter is not used as identity metadata.
5. Directories without `skill.yaml` are ignored for builtin skill registration.

This rule applies across builtin domains, including:

- `structure-type`
- `analysis`
- `code-check`
- `load-boundary`
- `validation`
- `report-export`
- `visualization`

### 2.3 Runtime and Plugin Layer

`skill.yaml` defines what a skill is. Runtime/plugin modules define how a skill executes.

- `AgentSkillLoader.loadBundles()` reads `skill.yaml` plus stage Markdown content.
- `AgentSkillLoader.loadPlugins()` may still attach `manifest.ts` / `handler.ts` style runtime modules for executable plugins, especially in `structure-type`.
- These runtime modules are no longer the static identity source for builtin skills.

Builtin skill loading now follows one canonical catalog rule:

- `/api/v1/agent/skills` and `/api/v1/agent/capability-matrix` are two projections over the same normalized builtin skill catalog.
- Skill ids exposed to the frontend must use canonical ids.
- Legacy ids may remain only as aliases for migration and backward compatibility, and should not be used as the primary id shown to users.

In the current implementation, `AgentSkillRuntime.listSkillManifests()` uses builtin `skill.yaml` manifests as the primary runtime manifest source. Executable plugin manifests are only appended when a plugin does not already have a corresponding `skill.yaml`.

Builtin `structure-type` manifests now directly authorize modeling tools only:

- `draft_model`
- `update_model`

Execution-chain tools such as `validate_model`, `run_analysis`, `run_code_check`, and `generate_report` are no longer granted directly by `structure-type` manifests. They are authorized through the downstream domain manifests activated for the current turn.

Before entering the execution chain, the agent now derives the downstream domain skill set explicitly for the current turn:

- The `analysis` domain selects one preferred analysis skill from `skill.yaml` metadata based on `analysisType`, `engineId`, structural model family, and any explicit skill selection.
- The `code-check` domain resolves skill id and design-code mapping from `skill.yaml` metadata.
- `validation` and `report-export` are activated on demand through their canonical builtin skill manifests.

In the current implementation, the actual `validation`, `analysis`, `code-check`, and `report-export` execution entrypoints are wrapped by `AgentSkillRuntime`: the agent no longer assembles those domain registries or report-domain details directly, and the selected downstream skill id is written back into result `meta` and tool-trace attribution.

## 2.4 Builtin Tool Discovery

Builtin tools live under `backend/src/agent-tools/<tool-id>/`.

Every builtin tool directory must contain:

| File | Required | Purpose |
|------|----------|---------|
| `tool.yaml` | Yes | Canonical static metadata: `id`, `tier`, `category`, dependencies, schemas, and error codes |

Builtin tool loading follows the same manifest-first rule:

1. The runtime scans `backend/src/agent-tools/` recursively.
2. A directory is considered a builtin tool only if it contains `tool.yaml`.
3. `tool.yaml` becomes the source of truth for protocol metadata, builtin tool catalogs, and runtime tool resolution.
4. Old TypeScript manifest constants are no longer used as the runtime source of truth.

## 2.5 Runtime Status Projection

The current `/api/v1/agent/capability-matrix` also exposes `runtimeStatus` for each skill and each domain summary so the stable taxonomy can be distinguished from actual runtime wiring:

- `active`: participates in main orchestration, activation, authorization, execution, and trace.
- `partial`: connected to runtime, but still platform-managed or not yet packaged as a full first-class skill.
- `discoverable`: present in the taxonomy, but not yet part of the main orchestration flow.
- `reserved`: kept as an architectural slot without current runtime capability.

### 2.6 Analysis Engine Availability and Skill Impact

`engineId` declared inside a skill is a static routing hint, not a guarantee that the engine is usable at runtime.

- A skill may declare which analysis engine family it targets, for example OpenSees today, or future integrations such as YJK / PKPM.
- The actual runtime engine set comes from the engine catalog and current runtime health state.
- Before an analysis skill can participate in execution, the runtime must verify that the candidate engine is:
  - enabled
  - available
  - compatible with the required model family
  - compatible with the requested analysis type

Therefore, engine availability is a runtime gate that directly affects downstream skill activation and execution eligibility. A skill may be correctly loaded in the taxonomy, but still be filtered out for execution if its required engine is currently unavailable or incompatible.

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
