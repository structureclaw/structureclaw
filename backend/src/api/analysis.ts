import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AnalysisService } from '../services/analysis.js';
import {
  BUILTIN_GROUND_MOTION_CATALOG,
  COMMON_RECORDED_GROUND_MOTION_REFERENCES,
} from '../agent-skills/analysis/opensees-seismic/ground-motion-catalog-meta.js';

const analysisService = new AnalysisService();

// 分析请求验证
export const createAnalysisSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['static', 'dynamic', 'seismic', 'nonlinear', 'stability']),
  modelId: z.string(),
  engineId: z.string().optional(),
  parameters: z.object({
    loadCases: z.array(z.any()).default([]),
    combinations: z.array(z.any()).optional(),
    timeSteps: z.number().optional(),
    dampingRatio: z.number().optional(),
    groundMotion: z.any().optional(),
    seismicWorkflow: z.record(z.string(), z.unknown()).optional(),
    designCode: z.string().optional(),
    autoCodeCheck: z.boolean().optional(),
  }),
});

const createModelSchema = z.object({
  name: z.string().min(1),
  conversationId: z.string().optional(),
  coordinate_system: z.object({
    semantics: z.literal('global-z-up'),
    version: z.literal(1),
    dimension: z.enum(['2d', '3d']),
    plane: z.union([z.literal('xz'), z.null()]),
    dof_order: z.tuple([
      z.literal('ux'),
      z.literal('uy'),
      z.literal('uz'),
      z.literal('rx'),
      z.literal('ry'),
      z.literal('rz'),
    ]),
  }).superRefine((value, context) => {
    if (value.dimension === '2d' && value.plane !== 'xz') {
      context.addIssue({ code: 'custom', message: 'Canonical 2-D models must use the X-Z plane' });
    }
    if (value.dimension === '3d' && value.plane !== null) {
      context.addIssue({ code: 'custom', message: 'Canonical 3-D models cannot declare a 2-D plane' });
    }
  }),
  nodes: z.array(z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    restraints: z.array(z.boolean()).length(6).optional(),
  })),
  elements: z.array(z.object({
    id: z.string(),
    type: z.enum(['beam', 'column', 'truss', 'shell', 'solid', 'wall', 'slab', 'link', 'brace']),
    nodes: z.array(z.string()),
    material: z.string(),
    section: z.string(),
  })),
  materials: z.array(z.object({
    id: z.string(),
    name: z.string(),
    E: z.number(),
    nu: z.number(),
    rho: z.number(),
    fy: z.number().optional(),
  })),
  sections: z.array(z.any()),
});

export async function analysisRoutes(fastify: FastifyInstance) {
  // 内置地震波目录元数据，不返回完整波形数组。
  fastify.get('/seismic/ground-motion-catalog', {
    schema: {
      tags: ['Analysis'],
      summary: '获取内置抗震地震波目录',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      source: 'builtin_artificial',
      records: BUILTIN_GROUND_MOTION_CATALOG,
      referenceSource: 'metadata_only',
      referenceRecords: COMMON_RECORDED_GROUND_MOTION_REFERENCES,
    });
  });

  // 创建结构模型
  fastify.post('/models', {
    schema: {
      tags: ['Analysis'],
      summary: '创建结构模型',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createModelSchema> }>, reply: FastifyReply) => {
    const body = createModelSchema.parse(request.body);

    const model = await analysisService.createModel(body);

    return reply.send(model);
  });

  // 获取模型
  fastify.get('/models/:id', {
    schema: {
      tags: ['Analysis'],
      summary: '获取结构模型详情',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const model = await analysisService.getModel(id);
    return reply.send(model);
  });

  // 创建分析任务
  fastify.post('/tasks', {
    schema: {
      tags: ['Analysis'],
      summary: '创建分析任务',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createAnalysisSchema> }>, reply: FastifyReply) => {
    const body = createAnalysisSchema.parse(request.body);

    const task = await analysisService.createAnalysisTask(body);

    return reply.send(task);
  });

  // 运行分析
  fastify.post('/tasks/:id/run', {
    schema: {
      tags: ['Analysis'],
      summary: '运行分析任务',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const result = await analysisService.runAnalysis(id);
    return reply.send(result);
  });

  // 获取分析结果
  fastify.get('/tasks/:id/results', {
    schema: {
      tags: ['Analysis'],
      summary: '获取分析结果',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const results = await analysisService.getResults(id);
    return reply.send(results);
  });

  // 规范校核
  fastify.post('/code-check', {
    schema: {
      tags: ['Analysis'],
      summary: '规范校核',
    },
  }, async (
    request: FastifyRequest<{ Body: { modelId: string; code: string; elements: string[]; context?: Record<string, unknown> } }>,
    reply: FastifyReply
  ) => {
    const body = request.body;
    const result = await analysisService.codeCheck(body);
    return reply.send(result);
  });
}
