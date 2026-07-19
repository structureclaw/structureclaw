export const STRUCTURAL_COORDINATE_SEMANTICS = 'global-z-up' as const;
export const STRUCTURAL_COORDINATE_CONTRACT_VERSION = 1 as const;
export const STRUCTURAL_DOF_ORDER = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;

export type StructuralFrameDimension = '2d' | '3d';

export type StructuralCoordinateSystem = {
  semantics: typeof STRUCTURAL_COORDINATE_SEMANTICS;
  version: typeof STRUCTURAL_COORDINATE_CONTRACT_VERSION;
  dimension: StructuralFrameDimension;
  plane: 'xz' | null;
  dof_order: typeof STRUCTURAL_DOF_ORDER;
};

export const FIXED_RESTRAINT = [true, true, true, true, true, true] as const;
export const PINNED_RESTRAINT = [true, true, true, false, false, false] as const;
export const ROLLER_X_RESTRAINT = [false, true, true, false, false, false] as const;

const COORDINATE_TOLERANCE = 1e-9;

export function buildStructuralCoordinateSystem(
  dimension: StructuralFrameDimension,
): StructuralCoordinateSystem {
  return {
    semantics: STRUCTURAL_COORDINATE_SEMANTICS,
    version: STRUCTURAL_COORDINATE_CONTRACT_VERSION,
    dimension,
    plane: dimension === '2d' ? 'xz' : null,
    dof_order: STRUCTURAL_DOF_ORDER,
  };
}

function withGlobalLoadReferenceFrames(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((loadCase) => {
    if (!loadCase || typeof loadCase !== 'object' || Array.isArray(loadCase)) return loadCase;
    const loadCaseRecord = loadCase as Record<string, unknown>;
    const loads = Array.isArray(loadCaseRecord.loads)
      ? loadCaseRecord.loads.map((load) => {
          if (!load || typeof load !== 'object' || Array.isArray(load)) return load;
          const loadRecord = load as Record<string, unknown>;
          const sourceFrame = loadRecord.reference_frame;
          if (sourceFrame !== undefined && sourceFrame !== 'global' && sourceFrame !== 'element-local') {
            throw new Error(`Invalid load reference_frame '${String(sourceFrame)}'`);
          }
          return {
            ...loadRecord,
            reference_frame: sourceFrame ?? 'global',
          };
        })
      : loadCaseRecord.loads;
    return { ...loadCaseRecord, loads };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function entityId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function resolveEntityAlias(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): string | null {
  const values = keys
    .filter((key) => record[key] !== undefined && record[key] !== null)
    .map((key) => entityId(record[key]));
  if (values.some((value) => !value)) {
    throw new Error(`${label} must have a non-empty id`);
  }
  const unique = [...new Set(values as string[])];
  if (unique.length > 1) throw new Error(`${label} contains conflicting aliases`);
  return unique[0] ?? null;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nonzero(value: unknown): boolean {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) > COORDINATE_TOLERANCE;
}

/** Validate the coordinate-sensitive portion of a model before it leaves a builder. */
export function assertCanonicalCoordinateModel(
  model: Record<string, unknown>,
  dimension: StructuralFrameDimension,
): void {
  const coordinateSystem = asRecord(model.coordinate_system);
  if (
    !coordinateSystem
    || coordinateSystem.semantics !== STRUCTURAL_COORDINATE_SEMANTICS
    || coordinateSystem.version !== STRUCTURAL_COORDINATE_CONTRACT_VERSION
    || coordinateSystem.dimension !== dimension
    || coordinateSystem.plane !== (dimension === '2d' ? 'xz' : null)
    || !Array.isArray(coordinateSystem.dof_order)
    || coordinateSystem.dof_order.length !== STRUCTURAL_DOF_ORDER.length
    || coordinateSystem.dof_order.some((value, index) => value !== STRUCTURAL_DOF_ORDER[index])
  ) {
    throw new Error('Structural model must declare the canonical global-z-up coordinate contract');
  }
  const metadata = asRecord(model.metadata);
  if (
    metadata?.coordinateSemantics !== undefined
    && metadata.coordinateSemantics !== STRUCTURAL_COORDINATE_SEMANTICS
  ) {
    throw new Error('metadata.coordinateSemantics conflicts with the canonical coordinate contract');
  }
  if (
    metadata?.coordinateContractVersion !== undefined
    && metadata.coordinateContractVersion !== STRUCTURAL_COORDINATE_CONTRACT_VERSION
  ) {
    throw new Error('metadata.coordinateContractVersion conflicts with the canonical coordinate contract');
  }
  if (metadata?.frameDimension !== undefined && metadata.frameDimension !== dimension) {
    throw new Error('metadata.frameDimension conflicts with the canonical coordinate contract');
  }

  const nodes = Array.isArray(model.nodes) ? model.nodes : [];
  const nodeIds = new Set<string>();
  const nodeCoordinates = new Map<string, readonly [number, number, number]>();
  for (const value of nodes) {
    const node = asRecord(value);
    const id = entityId(node?.id);
    if (!node || !id) throw new Error('Every structural node must have a non-empty id');
    if (nodeIds.has(id)) throw new Error(`Duplicate structural node id '${id}'`);
    nodeIds.add(id);
    const x = finiteNumber(node.x, `Node '${id}' global X`);
    const y = finiteNumber(node.y, `Node '${id}' global Y`);
    const z = finiteNumber(node.z, `Node '${id}' global Z`);
    nodeCoordinates.set(id, [x, y, z]);
    if (dimension === '2d' && Math.abs(y) > COORDINATE_TOLERANCE) {
      throw new Error(`Node '${id}' has non-zero global Y in a canonical 2-D X-Z model`);
    }
    if (
      node.restraints !== undefined
      && (!Array.isArray(node.restraints)
        || node.restraints.length !== STRUCTURAL_DOF_ORDER.length
        || node.restraints.some((entry) => typeof entry !== 'boolean'))
    ) {
      throw new Error(`Node '${id}' restraints must contain six booleans in ux/uy/uz/rx/ry/rz order`);
    }
  }

  const elements = Array.isArray(model.elements) ? model.elements : [];
  const elementIds = new Set<string>();
  const elementDirections = new Map<string, readonly [number, number, number]>();
  for (const value of elements) {
    const element = asRecord(value);
    const id = entityId(element?.id);
    if (!element || !id) throw new Error('Every structural element must have a non-empty id');
    if (elementIds.has(id)) throw new Error(`Duplicate structural element id '${id}'`);
    elementIds.add(id);
    if (!Array.isArray(element.nodes) || element.nodes.length < 2) {
      throw new Error(`Element '${id}' must reference at least two nodes`);
    }
    if (new Set(element.nodes.map((nodeId) => entityId(nodeId))).size !== element.nodes.length) {
      throw new Error(`Element '${id}' contains duplicate node references`);
    }
    if (
      ['beam', 'column', 'truss', 'brace', 'link'].includes(String(element.type ?? 'beam'))
      && element.nodes.length !== 2
    ) {
      throw new Error(`Line element '${id}' must reference exactly two nodes`);
    }
    if (element.nodes.some((nodeId) => {
      const normalized = entityId(nodeId);
      return !normalized || !nodeIds.has(normalized);
    })) {
      throw new Error(`Element '${id}' references an unknown node`);
    }
    const start = nodeCoordinates.get(String(element.nodes[0]));
    const end = nodeCoordinates.get(String(element.nodes[1]));
    if (!start || !end) throw new Error(`Element '${id}' references an unknown node`);
    const direction = [end[0] - start[0], end[1] - start[1], end[2] - start[2]] as const;
    if (Math.hypot(...direction) <= COORDINATE_TOLERANCE) {
      throw new Error(`Element '${id}' has zero length`);
    }
    elementDirections.set(id, direction);
    if (element.rotation_angle !== undefined) {
      const rotation = finiteNumber(element.rotation_angle, `Element '${id}' rotation_angle`);
      if (dimension === '2d' && Math.abs(rotation) > COORDINATE_TOLERANCE) {
        throw new Error(`Element '${id}' cannot rotate its section axes in a canonical 2-D model`);
      }
    }
  }

  const referenceVectors = metadata?.elementReferenceVectors;
  if (referenceVectors !== undefined) {
    if (dimension === '2d') {
      throw new Error('Canonical 2-D local axes are fixed; elementReferenceVectors are not allowed');
    }
    const vectorRecords = asRecord(referenceVectors);
    if (!vectorRecords) throw new Error('metadata.elementReferenceVectors must be an object');
    for (const [elementId, rawVector] of Object.entries(vectorRecords)) {
      const direction = elementDirections.get(elementId);
      if (!direction) throw new Error(`Reference vector targets unknown element '${elementId}'`);
      if (
        !Array.isArray(rawVector)
        || rawVector.length !== 3
        || rawVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw new Error(`Element '${elementId}' reference vector must contain three finite numbers`);
      }
      const vector = rawVector as number[];
      const vectorLength = Math.hypot(vector[0], vector[1], vector[2]);
      const directionLength = Math.hypot(direction[0], direction[1], direction[2]);
      const crossLength = Math.hypot(
        vector[1] * direction[2] - vector[2] * direction[1],
        vector[2] * direction[0] - vector[0] * direction[2],
        vector[0] * direction[1] - vector[1] * direction[0],
      );
      if (
        vectorLength <= COORDINATE_TOLERANCE
        || crossLength / (vectorLength * directionLength) <= COORDINATE_TOLERANCE
      ) {
        throw new Error(`Element '${elementId}' reference vector cannot be zero or parallel to its axis`);
      }
    }
  }

  const loadCases = Array.isArray(model.load_cases) ? model.load_cases : [];
  for (const loadCaseValue of loadCases) {
    const loadCase = asRecord(loadCaseValue);
    if (!loadCase) throw new Error('Every structural load case must be an object');
    if (loadCase.loads !== undefined && !Array.isArray(loadCase.loads)) {
      throw new Error('Every structural load case loads field must be an array');
    }
    const loads = Array.isArray(loadCase?.loads) ? loadCase.loads : [];
    for (const loadValue of loads) {
      const load = asRecord(loadValue);
      if (!load) throw new Error('Every structural load must be an object');
      const referenceFrame = load.reference_frame ?? 'global';
      if (referenceFrame !== 'global' && referenceFrame !== 'element-local') {
        throw new Error(`Invalid load reference_frame '${String(referenceFrame)}'`);
      }
      const nodeId = resolveEntityAlias(load, ['node', 'nodeId', 'node_id'], 'Nodal load target');
      const elementId = resolveEntityAlias(load, ['element', 'elementId', 'element_id'], 'Member load target');
      if ((nodeId === null) === (elementId === null)) {
        throw new Error('Every structural load must target exactly one node or element');
      }
      if (nodeId && !nodeIds.has(nodeId)) throw new Error(`Load references unknown node '${nodeId}'`);
      if (elementId && !elementIds.has(elementId)) throw new Error(`Load references unknown element '${elementId}'`);
      if (referenceFrame === 'element-local' && !elementId) {
        throw new Error("Only member loads may use reference_frame='element-local'");
      }
      const legacyComponentNames = [
        'Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz', 'momentX', 'momentY', 'momentZ',
      ].filter((key) => load[key] !== undefined);
      if (legacyComponentNames.length) {
        throw new Error(`V2 load components must use lowercase fx/fy/fz/mx/my/mz: ${legacyComponentNames.join(', ')}`);
      }
      if (nodeId && ['wx', 'wy', 'wz'].some((key) => load[key] !== undefined)) {
        throw new Error('Nodal loads must use fx/fy/fz and mx/my/mz, not member-load w components');
      }
      if (
        elementId
        && ['fx', 'fy', 'fz', 'mx', 'my', 'mz', 'forces'].some((key) => load[key] !== undefined)
      ) {
        throw new Error('Member loads must use wx/wy/wz, not nodal force or moment components');
      }

      const componentKeys = ['fx', 'fy', 'fz', 'mx', 'my', 'mz', 'wx', 'wy', 'wz'] as const;
      for (const key of componentKeys) {
        if (load[key] !== undefined) finiteNumber(load[key], `Load component '${key}'`);
      }
      if (load.forces !== undefined) {
        if (
          ['fx', 'fy', 'fz', 'mx', 'my', 'mz', 'value', 'magnitude', 'direction', 'axis']
            .some((key) => load[key] !== undefined)
        ) {
          throw new Error('Nodal load forces cannot be combined with component or directional aliases');
        }
        if (
          !Array.isArray(load.forces)
          || load.forces.length !== STRUCTURAL_DOF_ORDER.length
          || load.forces.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
        ) {
          throw new Error('Load forces must contain six finite values in fx/fy/fz/mx/my/mz order');
        }
      }
      if (dimension !== '2d') continue;
      if (referenceFrame === 'element-local') {
        if (nonzero(load.wy)) throw new Error('Local wy is out of plane for a canonical X-Z 2-D member load');
        continue;
      }
      const inactive = [load.fy, load.mx, load.mz, load.wy];
      if (Array.isArray(load.forces)) inactive.push(load.forces[1], load.forces[3], load.forces[5]);
      if (inactive.some(nonzero)) {
        throw new Error('A canonical X-Z 2-D load contains an out-of-plane component');
      }
    }
  }
}

/**
 * Stamp the single canonical coordinate contract at the model boundary.
 * The returned object is new; callers' draft objects are not mutated.
 */
export function withCanonicalCoordinateContract<T extends Record<string, unknown>>(
  model: T,
  dimension: StructuralFrameDimension,
): T & { coordinate_system: StructuralCoordinateSystem } {
  const metadata = model.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
    ? model.metadata as Record<string, unknown>
    : {};
  const canonical = {
    ...model,
    coordinate_system: buildStructuralCoordinateSystem(dimension),
    load_cases: withGlobalLoadReferenceFrames(model.load_cases),
    metadata: {
      ...metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      coordinateContractVersion: STRUCTURAL_COORDINATE_CONTRACT_VERSION,
      frameDimension: dimension,
    },
  };
  assertCanonicalCoordinateModel(canonical, dimension);
  return canonical;
}

export function stampDraftSemantics<T extends Record<string, unknown>>(draft: T): T & {
  coordinateSemantics: 'global-z-up';
} {
  return {
    ...draft,
    coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
  };
}
