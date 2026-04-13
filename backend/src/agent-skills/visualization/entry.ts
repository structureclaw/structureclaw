import type { VisualizationHints, ForceVector6, BucklingMode } from '../../agent-runtime/types.js';

export function extractVisualizationHints(analysis: unknown): VisualizationHints {
	const analysisPayload = analysis && typeof analysis === 'object' ? analysis as Record<string, unknown> : {};
	const analysisData = analysisPayload['data'];
	const analysisDataObject = analysisData && typeof analysisData === 'object' ? analysisData as Record<string, unknown> : {};
	const envelope = analysisDataObject['envelope'];
	const envelopeObject = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};

	return {
		// ── existing envelope fields ─────────────────────────────────────
		controlCase: (envelopeObject['controlCase'] as string | undefined) ?? null,
		controlNodeDisplacement: (envelopeObject['controlNodeDisplacement'] as number | undefined) ?? null,
		controlElementMoment: (envelopeObject['controlElementMoment'] as number | undefined) ?? null,
		hasEnvelope: Object.keys(envelopeObject).length > 0,

		// ── steel member utilization ─────────────────────────────────────
		memberUtilizationMap: extractMemberUtilizationMap(analysisDataObject),

		// ── steel connection forces ──────────────────────────────────────
		connectionForceMap: extractConnectionForceMap(analysisDataObject),

		// ── linear buckling modes ────────────────────────────────────────
		bucklingModes: extractBucklingModes(analysisDataObject),

		// ── plotly chart spec (populated by agent on demand) ─────────────
		plotlyChartSpec: null,
	};
}

// ---------------------------------------------------------------------------
// Private extractors
// ---------------------------------------------------------------------------

/**
 * Looks up a nested object property from two candidate parent keys.
 * Returns the first non-array object found, or null.
 */
function pickNestedObject(
	data: Record<string, unknown>,
	primaryKey: string,
	primaryField: string,
	fallbackKey: string,
	fallbackField: string,
): Record<string, unknown> | null {
	for (const [parentKey, fieldKey] of [[primaryKey, primaryField], [fallbackKey, fallbackField]] as const) {
		const parent = data[parentKey];
		if (parent && typeof parent === 'object') {
			const inner = (parent as Record<string, unknown>)[fieldKey];
			if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
				return inner as Record<string, unknown>;
			}
		}
	}
	return null;
}

/**
 * Extracts per-member utilization ratios from analysis data.
 *
 * Expected shape in analysis.data:
 *   steelCheck.memberUtilization: Record<string, number>
 *   OR codeCheck.memberUtilization: Record<string, number>
 */
function extractMemberUtilizationMap(data: Record<string, unknown>): Record<string, number> | null {
	const raw = pickNestedObject(data, 'steelCheck', 'memberUtilization', 'codeCheck', 'memberUtilization');
	if (!raw) return null;
	// Validate that every value is a number before narrowing the type
	if (!Object.values(raw).every((v) => typeof v === 'number')) return null;
	return raw as Record<string, number>;
}

/**
 * Extracts per-node connection force demand from analysis data.
 *
 * Expected shape in analysis.data:
 *   connectionCheck.nodeForces: Record<string, { Fx, Fy, Fz, Mx, My, Mz }>
 *   OR steelCheck.connectionForces: Record<string, { Fx, Fy, Fz, Mx, My, Mz }>
 */
function extractConnectionForceMap(data: Record<string, unknown>): Record<string, ForceVector6> | null {
	const raw = pickNestedObject(data, 'connectionCheck', 'nodeForces', 'steelCheck', 'connectionForces');
	if (!raw) return null;
	// Validate that every value is an object (ForceVector6 shape) before narrowing the type
	if (!Object.values(raw).every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) return null;
	return raw as Record<string, ForceVector6>;
}

/**
 * Extracts linear buckling mode shapes from analysis data.
 *
 * Expected shape in analysis.data:
 *   buckling.modes: Array<{ lambda: number; modeShape: Record<string, [number,number,number]> }>
 */
function extractBucklingModes(data: Record<string, unknown>): BucklingMode[] | null {
	const buckling = data['buckling'];
	if (!buckling || typeof buckling !== 'object') {
		return null;
	}
	const modes = (buckling as Record<string, unknown>)['modes'];
	if (!Array.isArray(modes) || modes.length === 0) {
		return null;
	}
	const result = (modes as unknown[]).filter(
		(entry): entry is BucklingMode =>
			entry !== null &&
			typeof entry === 'object' &&
			typeof (entry as Record<string, unknown>)['lambda'] === 'number' &&
			(entry as Record<string, unknown>)['modeShape'] !== null &&
			typeof (entry as Record<string, unknown>)['modeShape'] === 'object',
	);
	return result.length > 0 ? result : null;
}
