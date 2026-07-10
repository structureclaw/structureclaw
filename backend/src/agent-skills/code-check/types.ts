export interface CodeCheckDomainInput extends Record<string, unknown> {
  modelId: string;
  code: string;
  elements: string[];
  context: {
    analysisSummary: Record<string, unknown>;
    utilizationByElement: Record<string, unknown>;
    elementContextById?: Record<string, unknown>;
    modelSummary?: Record<string, unknown>;
    /** Per-element forces, section & material data for code-check consumption (gb50017/gb50010) */
    elementData?: Record<string, Record<string, unknown>>;
    code?: string;
    displayCode?: string;
    codeVersion?: string;
    codeBasis?: Array<Record<string, unknown> | string>;
  };
}
