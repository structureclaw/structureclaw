import { FastifyInstance } from 'fastify';
import { chatRoutes } from './chat.js';
import { projectRoutes } from './project.js';
import { skillRoutes } from './skill.js';
import { userRoutes } from './user.js';
import { analysisRoutes } from './analysis.js';
import { communityRoutes } from './community.js';
import { agentRoutes } from './agent.js';
import { analysisEngineRoutes } from './analysis-engine.js';
import { adminDatabaseRoutes } from './admin-database.js';
import { modelRoutes } from './models.js';
import { analysisRuntimeCompatibilityRoutes } from './analysis-runtime.js';

export async function registerRoutes(fastify: FastifyInstance) {
  await fastify.register(analysisRuntimeCompatibilityRoutes);

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
  await fastify.register(adminDatabaseRoutes, { prefix: `${apiPrefix}/admin/database` });
  await fastify.register(modelRoutes, { prefix: `${apiPrefix}/models` });

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
      adminDatabase: `${apiPrefix}/admin/database`,
      models: `${apiPrefix}/models`,
    },
  }));
}
