import { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../utils/database.js';

/**
 * 模型服务 - 提供模型相关的 API
 */
export async function modelRoutes(fastify: FastifyInstance) {
  // 获取最新的结构模型
  fastify.get('/latest', {
    schema: {
      tags: ['Models'],
      summary: '获取最新更新的结构模型',
    },
  }, async (_request: any, reply: FastifyReply) => {
    try {
      // 查询最近更新的模型
      const latestModel = await prisma.structuralModel.findFirst({
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (!latestModel) {
        return reply.code(404).send({
          errorCode: 'NO_MODELS_FOUND',
          message: 'No structural models found in the database',
        });
      }

      // 将数据库模型转换为 StructureModel v1 JSON 格式
      const modelJson: Record<string, unknown> = {
        schema_version: '1.0.0',
        nodes: latestModel.nodes,
        elements: latestModel.elements,
        materials: latestModel.materials,
        sections: latestModel.sections,
      };

      console.log('[Models API] Returning latest model:', latestModel.name, 'with nodes:', Array.isArray(modelJson.nodes) ? modelJson.nodes?.length : 0, 'elements:', Array.isArray(modelJson.elements) ? modelJson.elements?.length : 0);

      return reply.send({
        id: latestModel.id,
        name: latestModel.name,
        description: latestModel.description,
        createdAt: latestModel.createdAt,
        updatedAt: latestModel.updatedAt,
        model: modelJson,
      });
    } catch (error) {
      return reply.code(500).send({
        errorCode: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch latest model',
      });
    }
  });
}
