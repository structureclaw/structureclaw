import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getAgentService, LangGraphAgentService } from '../agent-langgraph/index.js';
import { AgentCapabilityService } from '../services/agent-capability.js';
import { AgentSkillHubService } from '../services/agent-skillhub.js';
import type { SkillDomain } from '../agent-runtime/types.js';

const agentService = getAgentService();
const capabilityService = new AgentCapabilityService();
const skillHubService = new AgentSkillHubService();

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
  conversationId: optionalIdSchema,
  traceId: optionalIdSchema,
  context: z.object({
    skillIds: z.array(z.string()).optional(),
    enabledToolIds: z.array(z.string()).optional(),
    disabledToolIds: z.array(z.string()).optional(),
    engineId: z.string().optional(),
    model: z.record(z.string(), z.any()).optional(),
    modelFormat: z.string().optional(),
    analysisType: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']).optional(),
    parameters: z.record(z.string(), z.any()).optional(),
    autoAnalyze: z.boolean().optional(),
    autoCodeCheck: z.boolean().optional(),
    designCode: z.string().optional(),
    codeCheckElements: z.array(z.string()).optional(),
    includeReport: z.boolean().optional(),
    reportFormat: z.enum(['json', 'markdown', 'both']).optional(),
    reportOutput: z.enum(['inline', 'file']).optional(),
    userDecision: z.enum(['provide_values', 'confirm_all', 'allow_auto_decide', 'revise']).optional(),
    providedValues: z.record(z.string(), z.any()).optional(),
  }).optional(),
});

const capabilityMatrixQuerySchema = z.object({
  analysisType: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']).optional(),
});

const skillHubDomainSchema = z.enum([
  'structure-type',
  'analysis',
  'load-boundary',
  'code-check',
  'data-input',
  'design',
  'drawing',
  'general',
  'material',
  'result-postprocess',
  'report-export',
  'section',
  'validation',
  'visualization',
] as const);

const skillHubSearchQuerySchema = z.object({
  q: z.string().optional(),
  domain: skillHubDomainSchema.optional(),
});

const skillHubMutationSchema = z.object({
  skillId: z.string().min(1),
});

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.get('/tools', {
    schema: {
      tags: ['Agent'],
      summary: '查询 Agent 工具协议与错误码',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(LangGraphAgentService.getProtocol());
  });

  fastify.get('/skills', {
    schema: {
      tags: ['Agent'],
      summary: '查询本地内置 Agent Skill 目录',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await agentService.listSkills());
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

  fastify.get('/skillhub/search', {
    schema: {
      tags: ['Agent'],
      summary: '搜索外部 SkillHub 扩展技能',
    },
  }, async (request: FastifyRequest<{ Querystring: z.infer<typeof skillHubSearchQuerySchema> }>, reply: FastifyReply) => {
    const query = skillHubSearchQuerySchema.parse(request.query);
    return reply.send(await skillHubService.search({ keyword: query.q, domain: query.domain as SkillDomain | undefined }));
  });

  fastify.get('/skillhub/installed', {
    schema: {
      tags: ['Agent'],
      summary: '列出已安装 SkillHub 扩展技能',
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ items: await skillHubService.listInstalled() });
  });

  fastify.post('/skillhub/install', {
    schema: {
      tags: ['Agent'],
      summary: '安装 SkillHub 扩展技能',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof skillHubMutationSchema> }>, reply: FastifyReply) => {
    const body = skillHubMutationSchema.parse(request.body);
    return reply.send(await skillHubService.install(body.skillId));
  });

  fastify.post('/skillhub/enable', {
    schema: {
      tags: ['Agent'],
      summary: '启用已安装 SkillHub 技能',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof skillHubMutationSchema> }>, reply: FastifyReply) => {
    const body = skillHubMutationSchema.parse(request.body);
    return reply.send(await skillHubService.enable(body.skillId));
  });

  fastify.post('/skillhub/disable', {
    schema: {
      tags: ['Agent'],
      summary: '禁用已安装 SkillHub 技能',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof skillHubMutationSchema> }>, reply: FastifyReply) => {
    const body = skillHubMutationSchema.parse(request.body);
    return reply.send(await skillHubService.disable(body.skillId));
  });

  fastify.post('/skillhub/uninstall', {
    schema: {
      tags: ['Agent'],
      summary: '卸载已安装 SkillHub 技能',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof skillHubMutationSchema> }>, reply: FastifyReply) => {
    const body = skillHubMutationSchema.parse(request.body);
    return reply.send(await skillHubService.uninstall(body.skillId));
  });

  fastify.post('/run', {
    schema: {
      tags: ['Agent'],
      summary: 'Agent 编排入口 (LangGraph ReAct)',
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
