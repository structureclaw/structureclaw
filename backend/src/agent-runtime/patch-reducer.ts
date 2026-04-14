export interface PatchReducerInput {
  patchId: string;
  patchKind: 'modelPatch' | 'designPatch';
  producerSkillId: string;
  baseModelRevision: number;
  status: 'proposed' | 'accepted' | 'rejected' | 'conflicted';
  priority: number;
  payload: Record<string, unknown>;
  /** Spec section 6.5 rule 5: merge strategy per payload key. Default is 'merge'. */
  mergeStrategy?: Record<string, 'replace' | 'merge' | 'append'>;
  reason: string;
  conflicts: Array<{ path: string; withPatchId: string }>;
  basedOn: Array<{ kind: string; artifactId: string; revision: number }>;
  createdAt: number;
}

export interface PatchReducerResult {
  model: Record<string, unknown>;
  revision: number;
  rejected: Array<{ patchId: string; reason: string }>;
  conflicted: Array<{ patchId: string; conflictWith: string; path: string }>;
  skipped: Array<{ patchId: string; reason: string }>;
}

export function applyPatches(
  baseModel: Record<string, unknown>,
  patches: PatchReducerInput[],
): PatchReducerResult {
  const model = structuredClone(baseModel);
  const rejected: PatchReducerResult['rejected'] = [];
  const conflicted: PatchReducerResult['conflicted'] = [];
  const skipped: PatchReducerResult['skipped'] = [];

  const currentRevision = (model.revision as number) ?? 1;

  const accepted = patches.filter((p) => p.status === 'accepted');
  const nonAccepted = patches.filter((p) => p.status !== 'accepted');

  for (const p of nonAccepted) {
    skipped.push({ patchId: p.patchId, reason: `status=${p.status}` });
  }

  const sorted = [...accepted].sort((a, b) => {
    if (a.patchKind === 'modelPatch' && b.patchKind !== 'modelPatch') return -1;
    if (a.patchKind !== 'modelPatch' && b.patchKind === 'modelPatch') return 1;
    if (a.patchKind === 'modelPatch') return a.priority - b.priority;
    return a.createdAt - b.createdAt;
  });

  const writtenPaths = new Map<string, string>();
  let anyApplied = false;

  for (const patch of sorted) {
    if (patch.baseModelRevision !== currentRevision) {
      rejected.push({ patchId: patch.patchId, reason: `baseModelRevision mismatch: expected ${currentRevision}, got ${patch.baseModelRevision}` });
      continue;
    }

    const conflictList = mergePayload(model, patch.payload, '', writtenPaths, patch.patchId, patch.mergeStrategy);
    if (conflictList.length > 0) {
      for (const c of conflictList) {
        conflicted.push({ patchId: patch.patchId, conflictWith: c.withPatchId, path: c.path });
      }
      continue;
    }

    anyApplied = true;
  }

  if (anyApplied) {
    model.revision = currentRevision + 1;
  }

  return {
    model,
    revision: model.revision as number,
    rejected,
    conflicted,
    skipped,
  };
}

function mergePayload(
  target: Record<string, unknown>,
  payload: Record<string, unknown>,
  prefix: string,
  writtenPaths: Map<string, string>,
  patchId: string,
  mergeStrategy?: Record<string, 'replace' | 'merge' | 'append'>,
): Array<{ path: string; withPatchId: string }> {
  const conflicts: Array<{ path: string; withPatchId: string }> = [];

  for (const key of Object.keys(payload)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = payload[key];
    const strategy = mergeStrategy?.[key] ?? 'merge';

    if (strategy === 'replace') {
      target[key] = structuredClone(value);
      writtenPaths.set(fullPath, patchId);
      continue;
    }

    if (strategy === 'append' && Array.isArray(value)) {
      const existing = Array.isArray(target[key]) ? target[key] as unknown[] : [];
      target[key] = [...existing, ...(value as unknown[])];
      writtenPaths.set(fullPath, patchId);
      continue;
    }

    if (Array.isArray(value)) {
      const existingArr = Array.isArray(target[key]) ? target[key] as unknown[] : [];
      const merged = structuredClone(existingArr);
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const itemPath = `${fullPath}[${i}]`;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          if (i < merged.length && merged[i] && typeof merged[i] === 'object' && !Array.isArray(merged[i])) {
            const nested = mergePayload(
              merged[i] as Record<string, unknown>,
              item as Record<string, unknown>,
              itemPath,
              writtenPaths,
              patchId,
              mergeStrategy,
            );
            conflicts.push(...nested);
          } else {
            merged[i] = structuredClone(item);
          }
        } else {
          const existingWriter = writtenPaths.get(itemPath);
          if (existingWriter && existingWriter !== patchId && merged[i] !== item) {
            conflicts.push({ path: itemPath, withPatchId: existingWriter });
          } else {
            merged[i] = item;
            writtenPaths.set(itemPath, patchId);
          }
        }
      }
      target[key] = merged;
    } else if (value && typeof value === 'object') {
      if (!(key in target) || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      const nested = mergePayload(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
        fullPath,
        writtenPaths,
        patchId,
        mergeStrategy,
      );
      conflicts.push(...nested);
    } else {
      const existingWriter = writtenPaths.get(fullPath);
      if (existingWriter && existingWriter !== patchId && target[key] !== value) {
        conflicts.push({ path: fullPath, withPatchId: existingWriter });
      } else {
        target[key] = value;
        writtenPaths.set(fullPath, patchId);
      }
    }
  }

  return conflicts;
}
