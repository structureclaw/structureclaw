export type AgentPolicyAnalysisType = 'static' | 'dynamic' | 'seismic' | 'nonlinear';
export type AgentPolicyReportFormat = 'json' | 'markdown' | 'both';
export type AgentPolicyReportOutput = 'inline' | 'file';
export type AgentPolicyLocale = 'zh' | 'en';
export type AgentPolicyInteractionStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';

export interface AgentPolicyDefaultProposal {
  paramKey: string;
  value: unknown;
  reason: string;
}

export interface AgentPolicyInteractionQuestion {
  paramKey: string;
  label: string;
  question: string;
  unit?: string;
  required: boolean;
  critical: boolean;
  suggestedValue?: unknown;
}

export class AgentPolicyService {
  private localize(locale: AgentPolicyLocale, zh: string, en: string): string {
    return locale === 'zh' ? zh : en;
  }

  inferAnalysisType(message: string): AgentPolicyAnalysisType {
    const text = message.toLowerCase();
    if (text.includes('地震') || text.includes('seismic')) {
      return 'seismic';
    }
    if (text.includes('动力') || text.includes('dynamic') || text.includes('时程')) {
      return 'dynamic';
    }
    if (text.includes('非线性') || text.includes('nonlinear')) {
      return 'nonlinear';
    }
    return 'static';
  }

  inferCodeCheckIntent(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('校核')
      || text.includes('规范')
      || text.includes('code-check')
      || text.includes('验算');
  }

  inferDesignCode(message: string): string | undefined {
    const match = message.toUpperCase().match(/GB\s*([0-9]{5})/);
    if (!match?.[1]) {
      return undefined;
    }
    return `GB${match[1]}`;
  }

  inferReportIntent(message: string): boolean | undefined {
    const text = message.toLowerCase();
    if (text.includes('报告') || text.includes('report')) {
      return true;
    }
    return undefined;
  }

  normalizeAnalysisType(value: string): AgentPolicyAnalysisType {
    if (value === 'static' || value === 'dynamic' || value === 'seismic' || value === 'nonlinear') {
      return value;
    }
    return 'static';
  }

  normalizeReportFormat(value: string): AgentPolicyReportFormat {
    if (value === 'json' || value === 'markdown' || value === 'both') {
      return value;
    }
    return 'both';
  }

  normalizeReportOutput(value: string): AgentPolicyReportOutput {
    if (value === 'inline' || value === 'file') {
      return value;
    }
    return 'inline';
  }

  buildDefaultProposals(nonCriticalMissing: string[], locale: AgentPolicyLocale): AgentPolicyDefaultProposal[] {
    return nonCriticalMissing.map((key) => {
      switch (key) {
        case 'analysisType':
          return { paramKey: key, value: 'static', reason: this.localize(locale, '默认采用静力分析，属于最保守且最常用起步工况。', 'Default to static analysis as the most conservative and common starting case.') };
        case 'autoCodeCheck':
          return { paramKey: key, value: true, reason: this.localize(locale, '默认开启规范校核以保证验算完整性。', 'Enable code checks by default to keep the verification flow complete.') };
        case 'designCode':
          return { paramKey: key, value: 'GB50017', reason: this.localize(locale, '默认采用钢结构设计标准 GB50017 进行保守校核。', 'Use GB50017 by default for a conservative steel-design check.') };
        case 'includeReport':
          return { paramKey: key, value: true, reason: this.localize(locale, '默认生成报告，便于复核输入与结果。', 'Generate a report by default so inputs and results can be reviewed.') };
        case 'reportFormat':
          return { paramKey: key, value: 'both', reason: this.localize(locale, '默认同时输出 json/markdown，兼顾机器和人工阅读。', 'Return both JSON and Markdown by default for machine and human consumption.') };
        case 'reportOutput':
          return { paramKey: key, value: 'inline', reason: this.localize(locale, '默认内联返回，减少文件写入依赖。', 'Return results inline by default to avoid file-output dependencies.') };
        default:
          return { paramKey: key, value: null, reason: this.localize(locale, '默认保守值。', 'Apply a conservative default.') };
      }
    });
  }

  getStageLabel(stage: AgentPolicyInteractionStage, locale: AgentPolicyLocale): string {
    switch (stage) {
      case 'intent':
        return this.localize(locale, '需求识别', 'Intent');
      case 'model':
        return this.localize(locale, '几何建模', 'Geometry');
      case 'loads':
        return this.localize(locale, '荷载条件', 'Loads');
      case 'analysis':
        return this.localize(locale, '分析设置', 'Analysis');
      case 'code_check':
        return this.localize(locale, '规范校核', 'Code Check');
      case 'report':
        return this.localize(locale, '报告输出', 'Report');
    }
  }

  mapNonStructuralMissingFieldLabel(key: string, locale: AgentPolicyLocale): string | null {
    switch (key) {
      case 'analysisType':
        return this.localize(locale, '分析类型（static/dynamic/seismic/nonlinear）', 'Analysis type (static/dynamic/seismic/nonlinear)');
      case 'designCode':
        return this.localize(locale, '规范编号（如 GB50017）', 'Design code (for example GB50017)');
      case 'autoCodeCheck':
        return this.localize(locale, '是否自动规范校核', 'Whether to run code checks automatically');
      case 'includeReport':
        return this.localize(locale, '是否生成报告', 'Whether to generate a report');
      case 'reportFormat':
        return this.localize(locale, '报告格式（json/markdown/both）', 'Report format (json/markdown/both)');
      case 'reportOutput':
        return this.localize(locale, '报告输出位置（inline/file）', 'Report output location (inline/file)');
      default:
        return null;
    }
  }

  buildNonStructuralInteractionQuestion(
    paramKey: string,
    locale: AgentPolicyLocale,
    critical: boolean,
  ): AgentPolicyInteractionQuestion | null {
    switch (paramKey) {
      case 'analysisType':
        return { paramKey, label: this.localize(locale, '分析类型', 'Analysis type'), question: this.localize(locale, '请选择分析类型。', 'Please choose the analysis type.'), required: true, critical, suggestedValue: 'static' };
      case 'autoCodeCheck':
        return { paramKey, label: this.localize(locale, '自动校核', 'Auto code check'), question: this.localize(locale, '是否自动执行规范校核？', 'Should code checks run automatically?'), required: true, critical, suggestedValue: true };
      case 'designCode':
        return { paramKey, label: this.localize(locale, '规范编号', 'Design code'), question: this.localize(locale, '请确认规范编号（例如 GB50017）。', 'Please confirm the design code (for example GB50017).'), required: true, critical, suggestedValue: 'GB50017' };
      case 'includeReport':
        return { paramKey, label: this.localize(locale, '报告开关', 'Report toggle'), question: this.localize(locale, '是否生成计算与校核报告？', 'Should an analysis and code-check report be generated?'), required: true, critical, suggestedValue: true };
      case 'reportFormat':
        return { paramKey, label: this.localize(locale, '报告格式', 'Report format'), question: this.localize(locale, '请确认报告格式。', 'Please confirm the report format.'), required: true, critical, suggestedValue: 'both' };
      case 'reportOutput':
        return { paramKey, label: this.localize(locale, '报告输出', 'Report output'), question: this.localize(locale, '请确认报告输出位置。', 'Please confirm where the report should be returned.'), required: true, critical, suggestedValue: 'inline' };
      default:
        return null;
    }
  }

  resolveInteractionStageFromMissing(
    structuralStage: AgentPolicyInteractionStage,
    missingKeys: string[],
  ): AgentPolicyInteractionStage {
    if (structuralStage === 'intent' || structuralStage === 'model' || structuralStage === 'loads') {
      return structuralStage;
    }
    if (missingKeys.includes('analysisType')) {
      return 'analysis';
    }
    if (missingKeys.includes('autoCodeCheck') || missingKeys.includes('designCode')) {
      return 'code_check';
    }
    return 'report';
  }
}
