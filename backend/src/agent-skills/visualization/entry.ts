export function extractVisualizationHints(analysis: unknown): Record<string, unknown> {
	const analysisPayload = analysis && typeof analysis === 'object' ? analysis as Record<string, unknown> : {};
	const analysisData = analysisPayload['data'];
	const analysisDataObject = analysisData && typeof analysisData === 'object' ? analysisData as Record<string, unknown> : {};
	const envelope = analysisDataObject['envelope'];
	const envelopeObject = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};

	return {
		controlCase: envelopeObject['controlCase'] ?? null,
		controlNodeDisplacement: envelopeObject['controlNodeDisplacement'] ?? null,
		controlElementMoment: envelopeObject['controlElementMoment'] ?? null,
		hasEnvelope: Object.keys(envelopeObject).length > 0,
	};
}
