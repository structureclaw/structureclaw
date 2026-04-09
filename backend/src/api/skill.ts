import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { LegacySkillCatalogService } from '../services/skill.js';

const legacySkillCatalogService = new LegacySkillCatalogService();

const createLegacySkillCatalogItemSchema = z.object({
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

async function legacySkillCatalogRoutes(fastify: FastifyInstance) {
  // Legacy bundled catalog items.
  fastify.get('/builtin', {
    schema: {
      tags: ['Legacy Skill Catalog'],
      summary: '获取旧版目录条目列表',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const catalogItems = legacySkillCatalogService.getBuiltinCatalogSkills();
    return reply.send(catalogItems);
  });

  // List legacy catalog items.
  fastify.get('/', {
    schema: {
      tags: ['Legacy Skill Catalog'],
      summary: '获取旧版目录条目列表',
    },
  }, async (request: FastifyRequest<{ Querystring: { category?: string; search?: string } }>, reply: FastifyReply) => {
    const { category, search } = request.query;
    const skills = await legacySkillCatalogService.listCatalogSkills({ category, search });
    return reply.send(skills);
  });

  // Get a legacy catalog item.
  fastify.get('/:id', {
    schema: {
      tags: ['Legacy Skill Catalog'],
      summary: '获取旧版目录条目详情',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const catalogItem = await legacySkillCatalogService.getCatalogSkill(id);
    return reply.send(catalogItem);
  });

  // Create a legacy catalog item.
  fastify.post('/', {
    schema: {
      tags: ['Legacy Skill Catalog'],
      summary: '创建旧版目录条目',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createLegacySkillCatalogItemSchema> }>, reply: FastifyReply) => {
    const body = createLegacySkillCatalogItemSchema.parse(request.body);
    const userId = request.user?.id;

    const catalogItem = await legacySkillCatalogService.createCatalogSkill({
      ...body,
      authorId: userId,
    });

    return reply.send(catalogItem);
  });

  // Install a legacy catalog item into a project.
  fastify.post('/:id/install', {
    schema: {
      tags: ['Legacy Skill Catalog'],
      summary: '将旧版目录条目安装到项目',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { projectId: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { projectId } = request.body;
    const userId = request.user?.id;

    const result = await legacySkillCatalogService.installCatalogSkill(id, projectId, userId);
    return reply.send(result);
  });

  // Invoke a legacy catalog item handler.
  fastify.post('/:id/invoke', {
    schema: {
      tags: ['Legacy Skill Catalog'],
      summary: '调用旧版目录条目',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const params = request.body as Record<string, unknown>;
    const userId = request.user?.id;

    const result = await legacySkillCatalogService.invokeCatalogSkill(id, params, userId);
    return reply.send(result);
  });

  // Rate a legacy catalog item.
  fastify.post('/:id/rate', {
    schema: {
      tags: ['Legacy Skill Catalog'],
      summary: '旧版目录条目评分',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { rating: number; comment?: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { rating, comment } = request.body;
    const userId = request.user?.id;

    const result = await legacySkillCatalogService.rateCatalogSkill(id, userId, rating, comment);
    return reply.send(result);
  });
}

export { legacySkillCatalogRoutes as skillRoutes };
