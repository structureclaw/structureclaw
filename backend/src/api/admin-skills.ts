/**
 * Admin skill management routes — list, inspect, and reload skills
 * (both builtin and user-defined workspace skills).
 */
import type { FastifyInstance } from 'fastify';
import { getAgentService } from '../agent-langgraph/agent-service.js';

export async function adminSkillsRoutes(fastify: FastifyInstance) {
  // List all skills (builtin + workspace)
  fastify.get('/', async () => {
    const service = getAgentService();
    const runtime = service.skillRuntime;
    const bundles = runtime.listSkills();
    const registry = runtime.getRegistry();
    const plugins = await registry.listPlugins();
    const pluginIds = new Set(plugins.map((p) => p.id));

    const skills = bundles.map((bundle) => ({
      id: bundle.id,
      name: bundle.name,
      description: bundle.description,
      domain: bundle.domain ?? 'general',
      structureType: bundle.structureType,
      stages: bundle.stages,
      hasHandler: pluginIds.has(bundle.id),
      priority: plugins.find((p) => p.id === bundle.id)?.manifest.priority ?? 0,
    }));

    return { skills, total: skills.length };
  });

  // Invalidate skill cache and reload from disk
  fastify.post('/reload', async () => {
    const service = getAgentService();
    service.skillRuntime.invalidateSkillCache();

    const bundles = service.skillRuntime.listSkills();
    return {
      reloaded: true,
      totalSkills: bundles.length,
      skillIds: bundles.map((b) => b.id),
    };
  });

  // Get details for a specific skill
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const service = getAgentService();
    const bundles = service.skillRuntime.listSkills();
    const bundle = bundles.find((b) => b.id === id);

    if (!bundle) {
      return reply.code(404).send({ error: `Skill '${id}' not found` });
    }

    const registry = service.skillRuntime.getRegistry();
    const plugins = await registry.listPlugins();
    const plugin = plugins.find((p) => p.id === id);

    return {
      ...bundle,
      hasHandler: !!plugin,
      manifest: plugin?.manifest ?? null,
    };
  });
}
