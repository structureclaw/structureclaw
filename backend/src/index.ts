import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { registerRoutes } from './api/routes.js';
import { prisma } from './utils/database.js';
import { redis } from './utils/redis.js';
import { logger } from './utils/logger.js';

const fastify = Fastify({
  logger: logger as any,
  bodyLimit: Math.max(1, config.bodyLimitMb) * 1024 * 1024,
});

// 注册插件
async function registerPlugins() {
  // CORS
  await fastify.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  // Swagger 文档
  await fastify.register(swagger, {
    swagger: {
      info: {
        title: 'StructureClaw API',
        description: '建筑结构分析设计社区平台 API',
        version: '0.1.0',
      },
      host: config.host + ':' + config.port,
      schemes: ['http', 'https'],
      consumes: ['application/json'],
      produces: ['application/json'],
    },
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}

// 启动服务
async function start() {
  try {
    await registerPlugins();

    // 注册路由
    await registerRoutes(fastify as any);

    // 健康检查
    fastify.get('/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: await checkDatabase(),
        redis: await checkRedis(),
      },
    }));

    // 启动服务器
    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`🚀 StructureClaw API running on http://${config.host}:${config.port}`);
    console.log(`📚 API Docs: http://${config.host}:${config.port}/docs`);

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// 检查数据库连接
async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// 检查 Redis 连接
async function checkRedis(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await fastify.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await fastify.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

start();
