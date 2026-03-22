import { prisma } from '../utils/database.js';
import { redis } from '../utils/redis.js';
import { ensureProjectId } from '../utils/demo-data.js';
import { AnalysisExecutionService } from './analysis-execution.js';

export interface CreateModelParams {
  name: string;
  nodes: any[];
  elements: any[];
  materials: any[];
  sections: any[];
  projectId?: string;
  createdBy?: string;
}

export interface CreateAnalysisParams {
  name: string;
  type: string;
  modelId: string;
  parameters: any;
  engineId?: string;
  createdBy?: string;
}

export class AnalysisService {
  private readonly executionService: AnalysisExecutionService;

  constructor() {
    this.executionService = new AnalysisExecutionService();
  }

  // 创建结构模型
  async createModel(params: CreateModelParams) {
    const projectId = await ensureProjectId(params.projectId, params.createdBy);

    const model = await prisma.structuralModel.create({
      data: {
        name: params.name,
        nodes: params.nodes,
        elements: params.elements,
        materials: params.materials,
        sections: params.sections,
        projectId,
        createdBy: params.createdBy,
      },
    });

    // 缓存模型数据
    await redis.setex(
      `model:${model.id}`,
      3600,
      JSON.stringify(model)
    );

    return model;
  }

  // 获取模型
  async getModel(id: string) {
    // 先从缓存获取
    const cached = await redis.get(`model:${id}`);
    if (cached) {
      return JSON.parse(cached);
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
      await redis.setex(`model:${id}`, 3600, JSON.stringify(model));
    }

    return model;
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
        createdBy: params.createdBy,
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
      const results = await this.executionService.analyze({
        type: analysis.type,
        engineId: (analysis.parameters as Record<string, unknown> | null)?.engineId,
        model: {
          schema_version: '1.0.0',
          nodes: analysis.model.nodes,
          elements: analysis.model.elements,
          materials: analysis.model.materials,
          sections: analysis.model.sections,
        },
        parameters: analysis.parameters,
      });
      if (results && results.success === false) {
        const errorCode = results.error_code || 'ANALYSIS_EXECUTION_FAILED';
        const message = results.message || 'Analysis execution failed';
        throw new Error(`[${errorCode}] ${message}`);
      }

      // 保存结果
      const updatedAnalysis = await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          results: results as any,
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
    return this.executionService.codeCheck({
      model_id: params.modelId,
      code: params.code,
      elements: params.elements,
      context: params.context || {},
      engineId: params.engineId,
    });
  }
}
