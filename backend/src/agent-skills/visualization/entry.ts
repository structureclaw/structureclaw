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
 * Extracts per-member utilization ratios from analysis data.
 *
 * Expected shape in analysis.data:
 *   steelCheck.memberUtilization: Record<string, number>
 *   OR codeCheck.memberUtilization: Record<string, number>
 */
function extractMemberUtilizationMap(data: Record<string, unknown>): Record<string, number> | null {
	const steelCheck = data['steelCheck'];
	if (steelCheck && typeof steelCheck === 'object') {
		const inner = (steelCheck as Record<string, unknown>)['memberUtilization'];
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			return inner as Record<string, number>;
		}
	}
	const codeCheck = data['codeCheck'];
	if (codeCheck && typeof codeCheck === 'object') {
		const inner = (codeCheck as Record<string, unknown>)['memberUtilization'];
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			return inner as Record<string, number>;
		}
	}
	return null;
}

/**
 * Extracts per-node connection force demand from analysis data.
 *
 * Expected shape in analysis.data:
 *   connectionCheck.nodeForces: Record<string, { Fx, Fy, Fz, Mx, My, Mz }>
 *   OR steelCheck.connectionForces: Record<string, { Fx, Fy, Fz, Mx, My, Mz }>
 */
function extractConnectionForceMap(data: Record<string, unknown>): Record<string, ForceVector6> | null {
	const connectionCheck = data['connectionCheck'];
	if (connectionCheck && typeof connectionCheck === 'object') {
		const inner = (connectionCheck as Record<string, unknown>)['nodeForces'];
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			return inner as Record<string, ForceVector6>;
		}
	}
	const steelCheck = data['steelCheck'];
	if (steelCheck && typeof steelCheck === 'object') {
		const inner = (steelCheck as Record<string, unknown>)['connectionForces'];
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			return inner as Record<string, ForceVector6>;
		}
	}
	return null;
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
	// Validate and coerce each entry; skip malformed entries silently.
	const result: BucklingMode[] = [];
	for (const entry of modes) {
		if (
			entry &&
			typeof entry === 'object' &&
			typeof (entry as Record<string, unknown>)['lambda'] === 'number' &&
			(entry as Record<string, unknown>)['modeShape'] &&
			typeof (entry as Record<string, unknown>)['modeShape'] === 'object'
		) {
			result.push(entry as BucklingMode);
		}
	}
	return result.length > 0 ? result : null;
}
