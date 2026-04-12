export function buildElementReferenceVectors(
  elements: Array<Record<string, unknown>>,
  nodes: Array<Record<string, unknown>>,
): Record<string, [number, number, number]> {
  const nodesById = new Map(nodes.map((node) => [node.id as string, node]));
  const result: Record<string, [number, number, number]> = {};

  for (const element of elements) {
    const [startId, endId] = element.nodes as [string, string];
    const start = nodesById.get(startId)!;
    const end = nodesById.get(endId)!;
    const dx = (end.x as number) - (start.x as number);
    const dy = (end.y as number) - (start.y as number);
    const dz = (end.z as number) - (start.z as number);
    const isColumn = Math.abs(dz) > 0 && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9;

    result[element.id as string] = isColumn ? [1, 0, 0] : [0, 0, 1];
  }

  return result;
}
