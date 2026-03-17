import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentService } from '../services/agent.js';
import { AgentCapabilityService } from '../services/agent-capability.js';

const agentService = new AgentService();
const capabilityService = new AgentCapabilityService();

const optionalIdSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return value;
}, z.string().optional());

const agentRunSchema = z.object({
  message: z.string().min(1).max(10000),
  mode: z.enum(['chat', 'execute', 'auto']).optional(),
  conversationId: optionalIdSchema,
  traceId: optionalIdSchema,
  context: z.object({
    skillIds: z.array(z.string()).optional(),
    engineId: z.string().optional(),
    model: z.record(z.any()).optional(),
    modelFormat: z.string().optional(),
    analysisType: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']).optional(),
    parameters: z.record(z.any()).optional(),
    autoAnalyze: z.boolean().optional(),
    autoCodeCheck: z.boolean().optional(),
    designCode: z.string().optional(),
    codeCheckElements: z.array(z.string()).optional(),
    includeReport: z.boolean().optional(),
    reportFormat: z.enum(['json', 'markdown', 'both']).optional(),
    reportOutput: z.enum(['inline', 'file']).optional(),
    userDecision: z.enum(['provide_values', 'confirm_all', 'allow_auto_decide', 'revise']).optional(),
    providedValues: z.record(z.any()).optional(),
  }).optional(),
});

const capabilityMatrixQuerySchema = z.object({
  analysisType: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']).optional(),
});

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.get('/tools', {
    schema: {
      tags: ['Agent'],
      summary: '查询 Agent 工具协议与错误码',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(AgentService.getProtocol());
  });

  fastify.get('/skills', {
    schema: {
      tags: ['Agent'],
      summary: '查询本地 Markdown Agent Skills',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(agentService.listSkills());
  });

  fastify.get('/capability-matrix', {
    schema: {
      tags: ['Agent'],
      summary: '查询技能与分析引擎能力矩阵',
    },
  }, async (request: FastifyRequest<{ Querystring: z.infer<typeof capabilityMatrixQuerySchema> }>, reply: FastifyReply) => {
    const query = capabilityMatrixQuerySchema.parse(request.query);
    return reply.send(await capabilityService.getCapabilityMatrix({ analysisType: query.analysisType }));
  });

  fastify.post('/run', {
    schema: {
      tags: ['Agent'],
      summary: 'OpenClaw 风格 Agent 编排入口',
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          conversationId: { type: 'string' },
          traceId: { type: 'string' },
          context: { type: 'object' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof agentRunSchema> }>, reply: FastifyReply) => {
    const body = agentRunSchema.parse(request.body);
    const result = await agentService.run(body);
    return reply.send(result);
  });
}
