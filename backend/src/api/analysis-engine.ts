import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AnalysisEngineCatalogService } from '../services/analysis-engine.js';

const service = new AnalysisEngineCatalogService();

const installManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(['python', 'http']),
  capabilities: z.array(z.enum(['analyze', 'validate', 'code-check'])).min(1),
  supportedAnalysisTypes: z.array(z.enum(['static', 'dynamic', 'seismic', 'nonlinear'])).optional(),
  supportedModelFamilies: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  routingHints: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  authTokenEnv: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  adapterKey: z.string().optional(),
  constraints: z.record(z.any()).optional(),
  installedSource: z.string().optional(),
  healthcheckPath: z.string().optional(),
  checkMode: z.enum(['ping', 'analyze', 'validate']).optional(),
}).superRefine((manifest, ctx) => {
  if (manifest.kind === 'python' && !manifest.adapterKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adapterKey'], message: 'Python engines require adapterKey' });
  }
  if (manifest.kind === 'http') {
    if (!manifest.baseUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseUrl'], message: 'HTTP engines require baseUrl' });
    }
    if (!manifest.supportedAnalysisTypes?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['supportedAnalysisTypes'], message: 'HTTP engines require supportedAnalysisTypes' });
    }
    if (!manifest.supportedModelFamilies?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['supportedModelFamilies'], message: 'HTTP engines require supportedModelFamilies' });
    }
  }
});

export async function analysisEngineRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['Analysis Engines'],
      summary: '列出可用分析引擎',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await service.listEngines());
  });

  fastify.get('/schema/manifest', {
    schema: {
      tags: ['Analysis Engines'],
      summary: '获取分析引擎 manifest 契约',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(service.getManifestSchema());
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Analysis Engines'],
      summary: '获取分析引擎详情',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const engine = await service.getEngine(request.params.id);
    if (!engine) {
      return reply.code(404).send({ errorCode: 'ENGINE_NOT_FOUND', message: 'Analysis engine not found' });
    }
    return reply.send(engine);
  });

  fastify.post('/install', {
    schema: {
      tags: ['Analysis Engines'],
      summary: '安装分析引擎 manifest',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof installManifestSchema> }>, reply: FastifyReply) => {
    const manifest = installManifestSchema.parse(request.body);
    return reply.send(await service.installEngine(manifest));
  });

  fastify.post('/:id/enable', {
    schema: {
      tags: ['Analysis Engines'],
      summary: '启用分析引擎',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return reply.send(await service.setEngineEnabled(request.params.id, true));
  });

  fastify.post('/:id/disable', {
    schema: {
      tags: ['Analysis Engines'],
      summary: '停用分析引擎',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return reply.send(await service.setEngineEnabled(request.params.id, false));
  });

  fastify.post('/:id/check', {
    schema: {
      tags: ['Analysis Engines'],
      summary: '检查分析引擎可用性',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return reply.send(await service.checkEngine(request.params.id));
  });
}
