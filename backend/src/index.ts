import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { config } from './config/index.js';
import { registerRoutes } from './api/routes.js';
import { prisma } from './utils/database.js';
import { getFastifyLoggerConfig } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the frontend static assets directory.
 * Installed-package: dist/frontend/ sits alongside dist/backend/.
 * Dev mode: SCLAW_FRONTEND_DIR points to frontend/out/ (static export).
 */
function resolveFrontendStaticDir(): string | null {
  // Check for SCLAW_FRONTEND_DIR override first
  const override = process.env.SCLAW_FRONTEND_DIR;
  if (override && existsSync(override)) {
    return override;
  }
  // Installed package layout: dist/frontend/ next to dist/backend/
  const installedDir = path.resolve(__dirname, '..', 'frontend');
  if (existsSync(path.join(installedDir, 'index.html'))) {
    return installedDir;
  }
  return null;
}

const fastify = Fastify({
  logger: getFastifyLoggerConfig(),
  bodyLimit: Math.max(1, config.bodyLimitMb) * 1024 * 1024,
});

// 注册插件
async function registerPlugins() {
  // CORS
  await fastify.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
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
    await registerRoutes(fastify);

    // Serve static frontend (installed-package mode only)
    const frontendDir = resolveFrontendStaticDir();
    if (frontendDir) {
      await fastify.register(fastifyStatic, {
        root: frontendDir,
        prefix: '/',
        wildcard: false,
      });

      // SPA fallback: serve index.html for non-API, non-static routes
      fastify.setNotFoundHandler((request, reply) => {
        if (!request.url.startsWith('/api/') && !request.url.startsWith('/docs')) {
          reply.sendFile('index.html');
        } else {
          reply.code(404).send({ error: 'Not found' });
        }
      });

      console.log(`🌐 Frontend UI served from ${frontendDir}`);
    }

    // 健康检查
    fastify.get('/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: await checkDatabase(),
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

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
});

start();
