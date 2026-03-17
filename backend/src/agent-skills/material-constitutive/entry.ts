import type { MaterialFamily } from '../../services/agent-skills/types.js';

const MATERIAL_FAMILY_SET = new Set<MaterialFamily>(['steel', 'concrete', 'composite', 'timber', 'masonry', 'generic']);

export interface MaterialConstitutiveProfile {
	family: MaterialFamily;
	grade?: string;
	elasticModulusMPa?: number;
	densityKgM3?: number;
	yieldStrengthMPa?: number;
	compressiveStrengthMPa?: number;
}

export function normalizeMaterialFamilies(value: unknown): MaterialFamily[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const normalized = value.filter((item): item is MaterialFamily => MATERIAL_FAMILY_SET.has(item as MaterialFamily));
	return Array.from(new Set(normalized));
}

export function buildDefaultMaterialProfile(family: MaterialFamily = 'steel'): MaterialConstitutiveProfile {
	if (family === 'concrete') {
		return {
			family,
			grade: 'C30',
			elasticModulusMPa: 30000,
			densityKgM3: 2500,
			compressiveStrengthMPa: 14.3,
		};
	}
	return {
		family,
		grade: family === 'steel' ? 'Q345' : undefined,
		elasticModulusMPa: family === 'steel' ? 205000 : undefined,
		densityKgM3: family === 'steel' ? 7850 : undefined,
		yieldStrengthMPa: family === 'steel' ? 345 : undefined,
	};
}
