/**
 * Resolve the observed trace from test execution results.
 * Normalizes draft and pipeline observations into a unified structure.
 */
function resolveObservedTrace({ testCase, draftResult, pipelineResult }) {
  if (pipelineResult) {
    return {
      enabledSkillIds: testCase.enabledSkillIds,
      selectedSkillIds: pipelineResult.routing?.selectedSkillIds || testCase.enabledSkillIds || [],
      activatedSkillIds: pipelineResult.routing?.activatedSkillIds || [],
      structuralSkillId: pipelineResult.routing?.structuralSkillId,
      analysisSkillId: pipelineResult.routing?.analysisSkillId,
      toolCalls: pipelineResult.toolCalls || []
    };
  }
  return {
    enabledSkillIds: testCase.enabledSkillIds,
    selectedSkillIds: testCase.enabledSkillIds || [],
    activatedSkillIds: [],
    structuralSkillId: draftResult?.structuralTypeMatch?.skillId || draftResult?.stateToPersist?.skillId,
    analysisSkillId: undefined,
    toolCalls: []
  };
}

module.exports = { resolveObservedTrace };
