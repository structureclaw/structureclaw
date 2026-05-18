# Visualization Skills Migration Plan

This directory is the step-1 skeleton for moving visualization extensions toward a detachable skill architecture.

The current PR intentionally keeps runtime behavior unchanged. Existing visualization logic still lives in the legacy extension module, and `registry.ts` only re-exports the public lookup helpers (`getVisualizationExtensionByView`, `getVisualizationViewLabelKey`) so future skill consumers have a single import surface.

## Current Status

- Step 1 is complete: shared skill contracts, namespaced state helpers, schema guard helpers, and a registry bridge exist under `skills/`.
- No built-in visualization skill has moved here yet.
- `modal.tsx`, `structural-scene.tsx`, and `extensions.tsx` should continue to behave as they did before this skeleton.
- Snapshot extension data must continue to flow through `snapshot.extensions`.

## Five-Step Migration Route

1. **Step 1 — Skeleton contracts (done)**
   - Add reusable TypeScript contracts in `types.ts`.
   - Add `useSkillState` and `useSkillStateValue` with namespaced keys in `state.ts`.
   - Add small schema validator helpers in `schema.ts`.
   - Keep `registry.ts` as a compatibility bridge to the legacy registry.

2. **Step 2 — Registry adapter**
   - Replace the bridge with a real skill registry shape.
   - Adapt the existing built-in utilization and buckling extension definitions into the new registry contract.
   - Keep public behavior and existing snapshot format stable while the registry internals change.

3. **Step 3 — Modal and toolbar integration**
   - Route aside, legend, toolbar, and activation hooks through skill definitions.
   - Remove view-specific branching from modal-level UI where a registered skill can provide the behavior.
   - After this step, view literals such as `view === 'buckling'` or `view === 'utilization'` must not appear in `modal.tsx`.

4. **Step 4 — Scene contribution integration**
   - Let skills contribute scene coloring, transforms, overlays, and frame-loop preferences through `SceneContribution`.
   - Keep `structural-scene.tsx` generic: it should consume skill contributions, not import individual skill internals.
   - Preserve existing rendering output for built-in views while moving the ownership boundary.

5. **Step 5 — Built-in skill extraction**
   - Move `builtin/utilization` and `builtin/buckling` into `skills/builtin/`.
   - Keep the registry as the only public import surface for built-in and external skills.
   - Add focused tests for registry discovery, availability, schema validation, and scene contributions.

## Do Not Do

- Do not add `view === 'buckling'` or `view === 'utilization'` literals in `modal.tsx` after step 3.
- Do not add a top-level `skill` field to visualization snapshots.
- Do not store skill payloads outside `snapshot.extensions`.
- Do not import a single skill's internal module from outside `skills/`.
- Do not move buckling or utilization rendering logic into this skeleton step.
- Do not add npm dependencies just to support the migration scaffolding.
- Do not make `skills/` responsible for backend SkillHub manifests; this directory is the frontend visualization contract layer.

## Snapshot Extension Boundary

Visualization skill data belongs under `snapshot.extensions` so the frontend has one stable extension payload boundary.

A snapshot-level shape should continue to look like this:

```ts
snapshot.extensions?.['builtin.utilization']
snapshot.extensions?.['builtin.buckling']
snapshot.extensions?.['skillhub.some-extension']
```

This keeps built-in visualization data and SkillHub-provided visualization data on the same channel without adding another top-level snapshot namespace.

## Registry Bridge

`registry.ts` currently re-exports only the public legacy lookup helpers (`getVisualizationExtensionByView`, `getVisualizationViewLabelKey`). The legacy `visualizationExtensionRegistry` array and `getAvailableVisualizationExtensions` filter remain module-private inside `extensions.tsx` on purpose.

That narrow bridge exists because step 1 only introduces contracts. It avoids changing runtime registration, toolbar rendering, aside rendering, scene rendering, or snapshot adaptation in the same PR, while still giving step-2 callers a single import path.

After step 2, `registry.ts` should become the canonical frontend visualization skill registry. At that point it can adapt or replace the old registry while keeping call sites stable.

## Import Boundary

Code outside this directory should import from the registry or shared contracts only. It should not reach into a future path such as `skills/builtin/buckling/internal`.

That boundary keeps each detachable skill replaceable and makes it possible to load built-in and external visualization skills through the same registry pipeline later.
