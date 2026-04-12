export function buildElementReferenceVectors(
  elements: Array<Record<string, unknown>>,
  nodes: Array<Record<string, unknown>>,
): Record<string, [number, number, number]> {
  const nodesById = new Map(
    nodes
      .map((node) => {
        const nodeId = typeof node.id === 'string' || typeof node.id === 'number'
          ? String(node.id)
          : null;
        return nodeId ? [nodeId, node] as const : null;
      })
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry !== null),
  );
  const result: Record<string, [number, number, number]> = {};

  for (const element of elements) {
    const elementId = typeof element.id === 'string' ? element.id : null;
    const elementNodes = Array.isArray(element.nodes) ? element.nodes : null;
    if (!elementId || !elementNodes || elementNodes.length < 2) {
      continue;
    }

    const [rawStartId, rawEndId] = elementNodes;
    if (
      (typeof rawStartId !== 'string' && typeof rawStartId !== 'number')
      || (typeof rawEndId !== 'string' && typeof rawEndId !== 'number')
    ) {
      continue;
    }

    const start = nodesById.get(String(rawStartId));
    const end = nodesById.get(String(rawEndId));
    if (!start || !end) {
      continue;
    }

    const startX = Number(start.x);
    const startY = Number(start.y);
    const startZ = Number(start.z);
    const endX = Number(end.x);
    const endY = Number(end.y);
    const endZ = Number(end.z);
    if (
      !Number.isFinite(startX)
      || !Number.isFinite(startY)
      || !Number.isFinite(startZ)
      || !Number.isFinite(endX)
      || !Number.isFinite(endY)
      || !Number.isFinite(endZ)
    ) {
      continue;
    }

    const dx = endX - startX;
    const dy = endY - startY;
    const dz = endZ - startZ;
    const isColumn = Math.abs(dz) > 0 && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9;

    result[elementId] = isColumn ? [1, 0, 0] : [0, 0, 1];
  }

  return result;
}
