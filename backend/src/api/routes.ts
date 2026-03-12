import { FastifyInstance } from 'fastify';
import { chatRoutes } from './chat.js';
import { projectRoutes } from './project.js';
import { skillRoutes } from './skill.js';
import { userRoutes } from './user.js';
import { analysisRoutes } from './analysis.js';
import { communityRoutes } from './community.js';
import { agentRoutes } from './agent.js';
import { analysisEngineRoutes } from './analysis-engine.js';

export async function registerRoutes(fastify: FastifyInstance) {
  // API 版本前缀
  const apiPrefix = '/api/v1';

  // 注册各模块路由
  await fastify.register(userRoutes, { prefix: `${apiPrefix}/users` });
  await fastify.register(chatRoutes, { prefix: `${apiPrefix}/chat` });
  await fastify.register(projectRoutes, { prefix: `${apiPrefix}/projects` });
  await fastify.register(skillRoutes, { prefix: `${apiPrefix}/skills` });
  await fastify.register(analysisRoutes, { prefix: `${apiPrefix}/analysis` });
  await fastify.register(analysisEngineRoutes, { prefix: `${apiPrefix}/analysis-engines` });
  await fastify.register(agentRoutes, { prefix: `${apiPrefix}/agent` });
  await fastify.register(communityRoutes, { prefix: `${apiPrefix}/community` });

  // API 信息
  fastify.get(`${apiPrefix}`, async () => ({
    name: 'StructureClaw API',
    version: '0.1.0',
    description: '建筑结构分析设计社区平台 API',
    endpoints: {
      users: `${apiPrefix}/users`,
      chat: `${apiPrefix}/chat`,
      projects: `${apiPrefix}/projects`,
      skills: `${apiPrefix}/skills`,
      analysis: `${apiPrefix}/analysis`,
      analysisEngines: `${apiPrefix}/analysis-engines`,
      agent: `${apiPrefix}/agent`,
      community: `${apiPrefix}/community`,
    },
  }));
}
