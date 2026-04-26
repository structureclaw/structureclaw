import { FastifyInstance } from 'fastify';
import { chatRoutes } from './chat.js';
import { analysisRoutes } from './analysis.js';
import { agentRoutes } from './agent.js';
import { analysisEngineRoutes } from './analysis-engine.js';
import { adminDatabaseRoutes } from './admin-database.js';
import { adminLlmRoutes } from './admin-llm.js';
import { analysisRuntimeRoutes } from './analysis-runtime.js';
import { fileRoutes } from './files.js';

export async function registerRoutes(fastify: FastifyInstance) {
  await fastify.register(analysisRuntimeRoutes);

  // API 版本前缀
  const apiPrefix = '/api/v1';

  // 注册各模块路由
  await fastify.register(chatRoutes, { prefix: `${apiPrefix}/chat` });
  await fastify.register(analysisRoutes, { prefix: `${apiPrefix}/analysis` });
  await fastify.register(analysisEngineRoutes, { prefix: `${apiPrefix}/analysis-engines` });
  await fastify.register(agentRoutes, { prefix: `${apiPrefix}/agent` });
  await fastify.register(adminDatabaseRoutes, { prefix: `${apiPrefix}/admin/database` });
  await fastify.register(adminLlmRoutes, { prefix: `${apiPrefix}/admin/llm` });
  await fastify.register(fileRoutes, { prefix: `${apiPrefix}/files` });

  // API 信息
  fastify.get(`${apiPrefix}`, async () => ({
    name: 'StructureClaw API',
    version: '0.1.0',
    description: '建筑结构分析设计平台 API',
    endpoints: {
      chat: `${apiPrefix}/chat`,
      analysis: `${apiPrefix}/analysis`,
      analysisEngines: `${apiPrefix}/analysis-engines`,
      agent: `${apiPrefix}/agent`,
      adminDatabase: `${apiPrefix}/admin/database`,
      adminLlm: `${apiPrefix}/admin/llm`,
    },
  }));
}
