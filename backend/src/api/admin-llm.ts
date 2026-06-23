import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  clearRuntimeVisionLlmSettings,
  clearRuntimeLlmSettings,
  getPublicLlmSettings,
  getPublicVisionLlmSettings,
  updateRuntimeLlmSettings,
  updateRuntimeVisionLlmSettings,
} from '../config/llm-runtime.js';

const updateLlmSettingsSchema = z.object({
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1),
  apiKey: z.string().optional(),
  apiKeyMode: z.enum(['keep', 'replace', 'inherit']).optional(),
});

const updateVisionLlmSettingsSchema = z.object({
  baseUrl: z.union([z.string().trim().url(), z.literal('')]).optional(),
  model: z.string().trim().min(1).optional(),
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

  fastify.get('/vision', {
    schema: {
      tags: ['Admin'],
      summary: 'Get vision LLM settings',
    },
  }, async () => getPublicVisionLlmSettings());

  fastify.put('/', {
    schema: {
      tags: ['Admin'],
      summary: 'Update global LLM settings',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof updateLlmSettingsSchema> }>) => {
    return updateRuntimeLlmSettings(updateLlmSettingsSchema.parse(request.body));
  });

  fastify.put('/vision', {
    schema: {
      tags: ['Admin'],
      summary: 'Update vision LLM settings',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof updateVisionLlmSettingsSchema> }>) => {
    return updateRuntimeVisionLlmSettings(updateVisionLlmSettingsSchema.parse(request.body));
  });

  fastify.delete('/', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete global LLM runtime overrides and restore defaults',
    },
  }, async () => clearRuntimeLlmSettings());

  fastify.delete('/vision', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete vision LLM runtime overrides',
    },
  }, async () => clearRuntimeVisionLlmSettings());
}
