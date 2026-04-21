export const STRUCTURAL_COORDINATE_SEMANTICS = 'global-z-up' as const;

export function stampDraftSemantics<T extends Record<string, unknown>>(draft: T): T & {
  coordinateSemantics: 'global-z-up';
} {
  return {
    ...draft,
    coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
  };
}
