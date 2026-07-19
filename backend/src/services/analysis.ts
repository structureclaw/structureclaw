import { prisma } from '../utils/database.js';
import { cache } from '../utils/cache.js';
import { ensureConversationId } from '../utils/demo-conversation.js';
import { AnalysisExecutionService } from './analysis-execution.js';
import { CodeCheckExecutionService, createLocalCodeCheckClient } from './code-check-execution.js';
import {
  buildCodeCheckInput,
  executeCodeCheckDomain,
} from '../agent-skills/code-check/entry.js';
import { resolveCodeCheckRule } from '../agent-skills/code-check/registry.js';
import { buildReportDomainArtifacts } from '../agent-skills/report-export/entry.js';
import { buildDefaultReportNarrative } from '../agent-runtime/report-template.js';
import type { AppLocale } from './locale.js';
import {
  assertCanonicalCoordinateModel,
  buildStructuralCoordinateSystem,
  STRUCTURAL_COORDINATE_CONTRACT_VERSION,
  STRUCTURAL_COORDINATE_SEMANTICS,
} from '../agent-runtime/coordinate-semantics.js';

export interface CreateModelParams {
  name: string;
  coordinate_system: ReturnType<typeof buildStructuralCoordinateSystem>;
  nodes: any[];
  elements: any[];
  materials: any[];
  sections: any[];
  conversationId?: string;
}

export interface CreateAnalysisParams {
  name: string;
  type: string;
  modelId: string;
  parameters: any;
  engineId?: string;
}

const DEFAULT_CHINA_SEISMIC_CODE = 'GB/T 50011-2010-2024';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function withDirectModelCoordinateContract<T extends Record<string, unknown>>(model: T): T & {
  coordinate_system: ReturnType<typeof buildStructuralCoordinateSystem>;
  metadata: Record<string, unknown>;
} {
  const coordinateSystem = asRecord(model.coordinate_system ?? model.coordinateSystem);
  const dimension = coordinateSystem.dimension;
  if (dimension !== '2d' && dimension !== '3d') {
    throw new Error('Direct structural models must include a typed coordinate_system contract; legacy geometry cannot be classified safely from coordinates alone');
  }
  const metadata = asRecord(model.metadata);
  const canonical = {
    ...model,
    schema_version: '2.0.0',
    unit_system: typeof model.unit_system === 'string' ? model.unit_system : 'SI',
    coordinate_system: coordinateSystem,
    metadata: {
      ...metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      coordinateContractVersion: STRUCTURAL_COORDINATE_CONTRACT_VERSION,
      frameDimension: dimension,
      source: typeof metadata.source === 'string' ? metadata.source : 'direct-analysis-api',
    },
  };
  assertCanonicalCoordinateModel(canonical, dimension);
  return {
    ...canonical,
    coordinate_system: buildStructuralCoordinateSystem(dimension),
  };
}

function nonEmptyRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function codeCheckPayload(codeCheck: unknown): Record<string, unknown> {
  const record = asRecord(codeCheck);
  const data = asRecord(record.data);
  return Object.keys(data).length > 0 ? data : record;
}

function codeCheckSummary(codeCheck: unknown): Record<string, unknown> | undefined {
  return nonEmptyRecord(codeCheckPayload(codeCheck).summary);
}

function formatDirectCodeCheckSummaryText(summary: Record<string, unknown> | undefined, locale: AppLocale): string {
  if (!summary) {
    return locale === 'zh' ? '未执行规范校核' : 'No code checks were executed';
  }
  const total = String(summary.total ?? 0);
  const passed = String(summary.passed ?? 0);
  const failed = String(summary.failed ?? 0);
  const warnings = String(summary.warnings ?? 0);
  const notApplicable = summary.notApplicable ?? summary.not_applicable;
  const notApplicableText = notApplicable !== undefined && notApplicable !== null
    ? (locale === 'zh'
      ? `，不适用/资料不足 ${String(notApplicable)}`
      : `, not applicable/unavailable ${String(notApplicable)}`)
    : '';

  return locale === 'zh'
    ? `校核通过 ${passed} / ${total}，失败 ${failed}，警告 ${warnings}${notApplicableText}`
    : `Code checks passed ${passed} / ${total}, failed ${failed}, warnings ${warnings}${notApplicableText}`;
}

function directReportLocale(parameters: Record<string, unknown>): AppLocale {
  return parameters.locale === 'en' ? 'en' : 'zh';
}

export function buildDirectSeismicReport(options: {
  analysisName: string;
  analysisType: string;
  analysisResults: Record<string, unknown>;
  codeCheck: unknown;
  parameters: Record<string, unknown>;
}): { summary: string; json: Record<string, unknown>; markdown: string } {
  const locale = directReportLocale(options.parameters);
  const analysisSuccess = Boolean(options.analysisResults.success);
  const codeCheckText = formatDirectCodeCheckSummaryText(codeCheckSummary(options.codeCheck), locale);
  const message = typeof options.parameters.message === 'string' && options.parameters.message.trim()
    ? options.parameters.message.trim()
    : typeof options.parameters.intent === 'string' && options.parameters.intent.trim()
      ? options.parameters.intent.trim()
      : locale === 'zh'
        ? `直接分析任务：${options.analysisName}`
        : `Direct analysis task: ${options.analysisName}`;
  const summary = locale === 'zh'
    ? `分析类型 ${options.analysisType}，分析${analysisSuccess ? '成功' : '失败'}，${codeCheckText}。`
    : `Analysis type ${options.analysisType}; analysis ${analysisSuccess ? 'succeeded' : 'failed'}; ${codeCheckText}.`;
  const {
    keyMetrics,
    clauseTraceability,
    controllingCases,
    visualizationHints,
  } = buildReportDomainArtifacts({
    designBasis: undefined,
    normalizedModel: undefined,
    postprocessedResult: options.analysisResults,
    codeCheckResult: options.codeCheck,
  });
  const jsonReport: Record<string, unknown> = {
    reportSchemaVersion: '1.0.0',
    intent: message,
    analysisType: options.analysisType,
    summary,
    keyMetrics,
    clauseTraceability,
    controllingCases,
    visualizationHints,
    analysis: options.analysisResults,
    codeCheck: options.codeCheck,
    generatedAt: new Date().toISOString(),
    meta: {
      reportSkillId: 'report-export-builtin',
      reportSource: 'direct-analysis-api',
    },
  };
  const markdown = buildDefaultReportNarrative({
    message,
    analysisType: 'seismic',
    analysisSuccess,
    codeCheckText,
    summary,
    keyMetrics,
    clauseTraceability,
    controllingCases,
    visualizationHints,
    analysis: options.analysisResults,
    codeCheck: options.codeCheck,
    locale,
  });

  return {
    summary,
    json: jsonReport,
    markdown,
  };
}

export function shouldRunDirectSeismicCodeCheck(
  analysisType: string,
  parameters: unknown,
): boolean {
  const params = asRecord(parameters);
  return analysisType === 'seismic'
    && params.autoCodeCheck !== false
    && Object.keys(asRecord(params.seismicWorkflow)).length > 0;
}

export function buildDirectAnalysisModelForCodeCheck(model: {
  coordinate_system?: unknown;
  coordinateSystem?: unknown;
  nodes: unknown;
  elements: unknown;
  materials: unknown;
  sections: unknown;
}): Record<string, unknown> {
  return withDirectModelCoordinateContract({
    schemaVersion: '2.0.0',
    schema_version: '2.0.0',
    coordinate_system: model.coordinate_system ?? model.coordinateSystem,
    nodes: Array.isArray(model.nodes) ? model.nodes : [],
    elements: Array.isArray(model.elements) ? model.elements : [],
    materials: Array.isArray(model.materials) ? model.materials : [],
    sections: Array.isArray(model.sections) ? model.sections : [],
    loadCases: [],
    loadCombinations: [],
    load_cases: [],
    load_combinations: [],
  });
}

export function resolveDirectChinaSeismicDesignCode(parameters: Record<string, unknown>): string {
  const designCode = typeof parameters.designCode === 'string' && parameters.designCode.trim()
    ? parameters.designCode.trim()
    : DEFAULT_CHINA_SEISMIC_CODE;
  try {
    const rule = resolveCodeCheckRule(designCode);
    if (rule.skillId === 'code-check-gb50011') {
      return designCode;
    }
  } catch {
    // Fall through to the explicit China seismic configuration error below.
  }
  throw new Error(
    `China seismic direct analysis requires a GB50011-compatible designCode (${DEFAULT_CHINA_SEISMIC_CODE}); received ${designCode}. `
    + `中国抗震直接分析必须使用兼容 GB50011 的设计规范（${DEFAULT_CHINA_SEISMIC_CODE}）。`,
  );
}

export class AnalysisService {
  private readonly executionService: AnalysisExecutionService;
  private readonly codeCheckExecutionService: CodeCheckExecutionService;

  constructor() {
    this.executionService = new AnalysisExecutionService();
    this.codeCheckExecutionService = new CodeCheckExecutionService();
  }

  // 创建结构模型
  async createModel(params: CreateModelParams) {
    const conversationId = await ensureConversationId(params.conversationId, params.name);
    const canonicalInput = withDirectModelCoordinateContract({
      coordinate_system: params.coordinate_system,
      nodes: params.nodes,
      elements: params.elements,
      load_cases: [],
    });

    const model = await prisma.structuralModel.create({
      data: {
        name: params.name,
        nodes: params.nodes,
        elements: params.elements,
        materials: params.materials,
        sections: params.sections,
        coordinateSystem: canonicalInput.coordinate_system,
        conversationId,
      },
    });
    const canonicalModel = withDirectModelCoordinateContract(model as unknown as Record<string, unknown>);

    // 缓存模型数据
    await cache.setex(
      `model:${model.id}`,
      3600,
      JSON.stringify(canonicalModel)
    );

    return canonicalModel;
  }

  // 获取模型
  async getModel(id: string) {
    // 先从缓存获取
    const cached = await cache.get(`model:${id}`);
    if (cached) {
      const cachedModel = JSON.parse(cached) as Record<string, unknown>;
      return withDirectModelCoordinateContract(cachedModel);
    }

    const model = await prisma.structuralModel.findUnique({
      where: { id },
      include: {
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (model) {
      const modelRecord = model as unknown as Record<string, unknown>;
      const canonicalModel = withDirectModelCoordinateContract(modelRecord);
      await cache.setex(`model:${id}`, 3600, JSON.stringify(canonicalModel));
      return canonicalModel;
    }

    return null;
  }

  // 创建分析任务
  async createAnalysisTask(params: CreateAnalysisParams) {
    return prisma.analysis.create({
      data: {
        name: params.name,
        type: params.type,
        modelId: params.modelId,
        parameters: params.engineId ? { ...(params.parameters || {}), engineId: params.engineId } : params.parameters,
        status: 'pending',
      },
    });
  }

  // 运行分析
  async runAnalysis(analysisId: string) {
    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { model: true },
    });

    if (!analysis) {
      throw new Error('分析任务不存在');
    }

    // 更新状态
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'running', startedAt: new Date() },
    });

    try {
      const persistedModel = {
        ...analysis.model,
        coordinate_system: analysis.model.coordinateSystem,
      };
      const canonicalAnalysisModel = withDirectModelCoordinateContract(persistedModel);
      const results = await this.executionService.analyze({
        type: analysis.type,
        engineId: (analysis.parameters as Record<string, unknown> | null)?.engineId,
        model: canonicalAnalysisModel,
        parameters: analysis.parameters,
      });
      if (results && results.success === false) {
        const errorCode = results.error_code || 'ANALYSIS_EXECUTION_FAILED';
        const message = results.message || 'Analysis execution failed';
        throw new Error(`[${errorCode}] ${message}`);
      }
      const parameters = asRecord(analysis.parameters);
      const shouldRunSeismicCodeCheck = shouldRunDirectSeismicCodeCheck(analysis.type, parameters);
      const analysisResults = asRecord(results);
      let finalResults: Record<string, unknown> = shouldRunSeismicCodeCheck
        ? analysisResults
        : (results as Record<string, unknown>);
      if (shouldRunSeismicCodeCheck) {
        const codeCheck = await this.runDirectSeismicCodeCheck({
          analysisId,
          model: canonicalAnalysisModel,
          analysisResults,
          parameters,
        });
        finalResults = {
          ...analysisResults,
          codeCheck,
          report: buildDirectSeismicReport({
            analysisName: analysis.name,
            analysisType: analysis.type,
            analysisResults,
            codeCheck,
            parameters,
          }),
        };
      }

      // 保存结果
      const updatedAnalysis = await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          results: finalResults as any,
        },
      });

      return updatedAnalysis;
    } catch (error: any) {
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          error: error.message,
          completedAt: new Date(),
        },
      });

      throw error;
    }
  }

  private async runDirectSeismicCodeCheck(options: {
    analysisId: string;
    model: {
      coordinate_system?: unknown;
      coordinateSystem?: unknown;
      nodes: unknown;
      elements: unknown;
      materials: unknown;
      sections: unknown;
    };
    analysisResults: Record<string, unknown>;
    parameters: Record<string, unknown>;
  }): Promise<unknown> {
    const designCode = resolveDirectChinaSeismicDesignCode(options.parameters);
    const model = buildDirectAnalysisModelForCodeCheck(options.model);
    const input = buildCodeCheckInput({
      traceId: options.analysisId,
      designCode,
      model,
      analysis: options.analysisResults,
      analysisParameters: options.parameters,
    });
    return executeCodeCheckDomain(
      createLocalCodeCheckClient(this.codeCheckExecutionService),
      input,
    );
  }

  // 获取分析结果
  async getResults(analysisId: string) {
    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        results: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return analysis;
  }

  // 规范校核
  async codeCheck(params: {
    modelId: string;
    code: string;
    elements: string[];
    context?: Record<string, unknown>;
    engineId?: string;
  }) {
    return this.codeCheckExecutionService.codeCheck({
      model_id: params.modelId,
      code: params.code,
      elements: params.elements,
      context: params.context || {},
      engineId: params.engineId,
    });
  }
}
