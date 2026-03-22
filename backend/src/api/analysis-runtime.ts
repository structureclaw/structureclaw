import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AnalysisExecutionService } from '../services/analysis-execution.js';

const service = new AnalysisExecutionService();

const validateSchema = z.object({
  model: z.record(z.any()),
  engineId: z.string().optional(),
});

const convertSchema = z.object({
  model: z.record(z.any()),
  target_schema_version: z.string().default('1.0.0'),
  source_format: z.string().default('structuremodel-v1'),
  target_format: z.string().default('structuremodel-v1'),
});

const analyzeSchema = z.object({
  type: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']),
  model: z.record(z.any()),
  parameters: z.record(z.any()).default({}),
  engineId: z.string().optional(),
});

const codeCheckSchema = z.object({
  model_id: z.string(),
  code: z.string(),
  elements: z.array(z.string()),
  context: z.record(z.any()).default({}),
  engineId: z.string().optional(),
});

export async function analysisRuntimeCompatibilityRoutes(fastify: FastifyInstance) {
  fastify.get('/schema/structure-model-v1', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await service.getStructureModelSchema());
  });

  fastify.get('/schema/converters', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await service.getConverterSchema());
  });

  fastify.get('/engines', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await service.listEngines());
  });

  fastify.get('/engines/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const engine = await service.getEngine(request.params.id);
    if (!engine) {
      return reply.code(404).send({ errorCode: 'ENGINE_NOT_FOUND', message: 'Analysis engine not found' });
    }
    return reply.send(engine);
  });

  fastify.post('/engines/:id/check', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return reply.send(await service.checkEngine(request.params.id));
  });

  fastify.post('/validate', async (request: FastifyRequest<{ Body: z.infer<typeof validateSchema> }>, reply: FastifyReply) => {
    return reply.send(await service.validate(validateSchema.parse(request.body)));
  });

  fastify.post('/convert', async (request: FastifyRequest<{ Body: z.infer<typeof convertSchema> }>, reply: FastifyReply) => {
    return reply.send(await service.convert(convertSchema.parse(request.body)));
  });

  fastify.post('/analyze', async (request: FastifyRequest<{ Body: z.infer<typeof analyzeSchema> }>, reply: FastifyReply) => {
    return reply.send(await service.analyze(analyzeSchema.parse(request.body)));
  });

  fastify.post('/code-check', async (request: FastifyRequest<{ Body: z.infer<typeof codeCheckSchema> }>, reply: FastifyReply) => {
    return reply.send(await service.codeCheck(codeCheckSchema.parse(request.body)));
  });
}
