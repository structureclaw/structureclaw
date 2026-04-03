const { createRequire } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/**
 * Create a lightweight Fastify server with real backend routes for integration tests.
 * Uses a temporary SQLite database and real LLM configuration.
 *
 * @param {object} context - Integration context with env vars
 * @returns {Promise<{ app: import('fastify').FastifyInstance, close: () => Promise<void> }>}
 */
async function createTestServer(context) {
  const backendRequire = createRequire(
    path.join(context.rootDir, "backend", "package.json")
  );
  const Fastify = backendRequire("fastify");

  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });

  // Apply env vars so the backend config module picks them up
  for (const [key, value] of Object.entries(context.env)) {
    if (value !== undefined && value !== "") {
      process.env[key] = value;
    }
  }

  // Register real backend routes
  const { agentRoutes } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href
  );
  const { chatRoutes } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "chat.js")).href
  );

  await app.register(agentRoutes, { prefix: "/api/v1/agent" });
  await app.register(chatRoutes, { prefix: "/api/v1/chat" });

  await app.ready();

  return {
    app,
    async close() {
      await app.close();
    },
  };
}

module.exports = { createTestServer };
