export interface CodeCheckDomainInput extends Record<string, unknown> {
  modelId: string;
  code: string;
  elements: string[];
  context: {
    analysisSummary: Record<string, unknown>;
    utilizationByElement: Record<string, unknown>;
    elementContextById?: Record<string, unknown>;
    modelSummary?: Record<string, unknown>;
  };
}
