import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  clearRuntimeLlmSettings,
  getPublicLlmSettings,
  updateRuntimeLlmSettings,
} from '../config/llm-runtime.js';

const updateLlmSettingsSchema = z.object({
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1),
  apiKey: z.string().optional(),
  apiKeyMode: z.enum(['keep', 'replace', 'inherit']).optional(),
});

export async function adminLlmRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['Admin'],
      summary: 'Get global LLM settings',
    },
  }, async () => getPublicLlmSettings());

  fastify.put('/', {
    schema: {
      tags: ['Admin'],
      summary: 'Update global LLM settings',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof updateLlmSettingsSchema> }>) => {
    return updateRuntimeLlmSettings(updateLlmSettingsSchema.parse(request.body));
  });

  fastify.delete('/', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete global LLM runtime overrides and restore defaults',
    },
  }, async () => clearRuntimeLlmSettings());
}
