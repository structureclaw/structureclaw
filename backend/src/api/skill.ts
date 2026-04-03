import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SkillService } from '../services/skill.js';

const skillService = new SkillService();

const createSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  category: z.enum([
    'analysis',
    'design',
    'modeling',
    'visualization',
    'report',
    'code-check',
    'optimization',
    'other',
  ]),
  version: z.string(),
  author: z.string(),
  tags: z.array(z.string()),
  config: z.object({
    triggers: z.array(z.string()),
    parameters: z.any(),
    handler: z.string(),
  }),
  isPublic: z.boolean().default(false),
});

export async function skillRoutes(fastify: FastifyInstance) {
  // 内置技能列表
  fastify.get('/builtin', {
    schema: {
      tags: ['Skills'],
      summary: '获取内置技能列表',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const skills = skillService.getBuiltinSkills();
    return reply.send(skills);
  });

  // 获取技能列表
  fastify.get('/', {
    schema: {
      tags: ['Skills'],
      summary: '获取技能列表',
    },
  }, async (request: FastifyRequest<{ Querystring: { category?: string; search?: string } }>, reply: FastifyReply) => {
    const { category, search } = request.query;
    const skills = await skillService.listSkills({ category, search });
    return reply.send(skills);
  });

  // 获取技能详情
  fastify.get('/:id', {
    schema: {
      tags: ['Skills'],
      summary: '获取技能详情',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const skill = await skillService.getSkill(id);
    return reply.send(skill);
  });

  // 创建技能
  fastify.post('/', {
    schema: {
      tags: ['Skills'],
      summary: '创建新技能',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createSkillSchema> }>, reply: FastifyReply) => {
    const body = createSkillSchema.parse(request.body);
    const userId = request.user?.id;

    const skill = await skillService.createSkill({
      ...body,
      authorId: userId,
    });

    return reply.send(skill);
  });

  // 安装技能
  fastify.post('/:id/install', {
    schema: {
      tags: ['Skills'],
      summary: '安装技能到项目',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { projectId: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { projectId } = request.body;
    const userId = request.user?.id;

    const result = await skillService.installSkill(id, projectId, userId);
    return reply.send(result);
  });

  // 调用技能
  fastify.post('/:id/invoke', {
    schema: {
      tags: ['Skills'],
      summary: '调用技能',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const params = request.body as Record<string, unknown>;
    const userId = request.user?.id;

    const result = await skillService.invokeSkill(id, params, userId);
    return reply.send(result);
  });

  // 技能评分
  fastify.post('/:id/rate', {
    schema: {
      tags: ['Skills'],
      summary: '技能评分',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { rating: number; comment?: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { rating, comment } = request.body;
    const userId = request.user?.id;

    const result = await skillService.rateSkill(id, userId, rating, comment);
    return reply.send(result);
  });
}
