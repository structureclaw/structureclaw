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

function hasConcreteStructuralRequest(text: string): boolean {
  if (!/\d/.test(text)) {
    return false;
  }

  return [
    '跨度',
    '荷载',
    '层高',
    '简支',
    '悬臂',
    '梁',
    '框架',
    '支座',
    'beam',
    'frame',
    'column',
    'span',
    'load',
    'support',
    'story',
    'bay',
    'cantilever',
    'midspan',
  ].some((pattern) => text.includes(pattern));
}

function hasNaturalStructuralExecutionIntent(text: string): boolean {
  return [
    '设计',
    '算一下',
    '算一算',
    '帮我算',
    '帮我设计',
    'design',
    'size',
    'sizing',
    'calculate',
  ].some((pattern) => text.includes(pattern));
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

  inferExecutionIntent(message: string): boolean {
    const text = message.toLowerCase().trim();
    if (!text) {
      return false;
    }

    const explicitExecutionIntent = [
      '执行分析',
      '开始分析',
      '运行分析',
      '直接分析',
      '开始计算',
      '运行计算',
      '执行计算',
      '开始求解',
      '运行求解',
      '分析这个模型',
      'run analysis',
      'start analysis',
      'perform analysis',
      'run the analysis',
      'analyze this model',
      'solve this model',
      'calculate the result',
    ].some((pattern) => text.includes(pattern));

    if (explicitExecutionIntent) {
      return true;
    }

    return hasConcreteStructuralRequest(text) && hasNaturalStructuralExecutionIntent(text);
  }

  inferProceedIntent(message: string): boolean {
    const text = message.toLowerCase().trim();
    if (!text) {
      return false;
    }

    return [
      '继续',
      '继续吧',
      '开始吧',
      '可以了',
      '就这样',
      '确认',
      '确认执行',
      '开始',
      'go ahead',
      'proceed',
      'continue',
      'run it',
      'start now',
      'confirm',
    ].some((pattern) => text.includes(pattern));
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

  inferReportFormat(message: string): AgentPolicyReportFormat | undefined {
    const text = message.toLowerCase();
    const hasJson = text.includes('json');
    const hasMarkdownWord = text.includes('markdown');
    const hasMdToken = /\bmd\b/.test(text) || /\.md\b/.test(text);
    const hasMarkdown = hasMarkdownWord || hasMdToken;

    if (hasJson && hasMarkdown) return 'both';
    if (text.includes('both') || text.includes('两种') || text.includes('都要')) return 'both';
    if (text.includes('默认') || text.includes('default') || text.includes('确认') || text.includes('confirm')) return 'both';
    if (hasJson) return 'json';
    if (hasMarkdown) return 'markdown';
    return undefined;
  }

  inferReportOutput(message: string): AgentPolicyReportOutput | undefined {
    const text = message.toLowerCase();
    const filePattern = /\bfile\b/;
    const inlinePattern = /\binline\b/;
    if (
      filePattern.test(text)
      || text.includes('文件')
      || text.includes('输出到文件')
      || text.includes('保存为文件')
    ) return 'file';
    if (
      inlinePattern.test(text)
      || text.includes('内联')
      || text.includes('直接')
      || text.includes('内联返回')
    ) return 'inline';
    if (text.includes('默认') || text.includes('default') || text.includes('确认') || text.includes('confirm')) return 'inline';
    return undefined;
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
    const proposals: AgentPolicyDefaultProposal[] = [];

    nonCriticalMissing.forEach((key) => {
      switch (key) {
        case 'analysisType':
          proposals.push({ paramKey: key, value: 'static', reason: this.localize(locale, '默认采用静力分析，属于最保守且最常用起步工况。', 'Default to static analysis as the most conservative and common starting case.') });
          return;
        case 'includeReport':
          proposals.push({ paramKey: key, value: true, reason: this.localize(locale, '默认生成报告，便于复核输入与结果。', 'Generate a report by default so inputs and results can be reviewed.') });
          return;
        case 'reportFormat':
          proposals.push({ paramKey: key, value: 'both', reason: this.localize(locale, '默认同时输出 json/markdown，兼顾机器和人工阅读。', 'Return both JSON and Markdown by default for machine and human consumption.') });
          return;
        case 'reportOutput':
          proposals.push({ paramKey: key, value: 'inline', reason: this.localize(locale, '默认内联返回，减少文件写入依赖。', 'Return results inline by default to avoid file-output dependencies.') });
          return;
        default:
          return;
      }
    });

    return proposals;
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
    return 'report';
  }
}
