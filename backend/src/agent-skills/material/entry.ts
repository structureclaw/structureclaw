import type { MaterialFamily } from '../../agent-runtime/types.js';

const MATERIAL_FAMILY_SET = new Set<MaterialFamily>(['steel', 'concrete', 'composite', 'timber', 'masonry', 'generic']);

export function normalizeMaterialFamilies(value: unknown): MaterialFamily[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const normalized = value.filter((item): item is MaterialFamily => MATERIAL_FAMILY_SET.has(item as MaterialFamily));
	return Array.from(new Set(normalized));
}
