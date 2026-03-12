import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ChatService } from '../services/chat.js';
import { AgentService } from '../services/agent.js';
import { config } from '../config/index.js';
import { isLlmTimeoutError, toLlmApiError } from '../utils/llm-error.js';

const chatService = new ChatService();
const agentService = new AgentService();

const optionalIdSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return value;
}, z.string().optional());

// 请求验证
const sendMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  mode: z.enum(['chat', 'execute', 'auto']).optional(),
  conversationId: optionalIdSchema,
  traceId: optionalIdSchema,
  context: z.object({
    projectId: z.string().optional(),
    model: z.record(z.any()).optional(),
    modelFormat: z.string().optional(),
    analysisType: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']).optional(),
    parameters: z.record(z.any()).optional(),
    autoAnalyze: z.boolean().optional(),
    autoCodeCheck: z.boolean().optional(),
    designCode: z.string().optional(),
    codeCheckElements: z.array(z.string()).optional(),
    includeReport: z.boolean().optional(),
    reportFormat: z.enum(['json', 'markdown', 'both']).optional(),
    reportOutput: z.enum(['inline', 'file']).optional(),
    userDecision: z.enum(['provide_values', 'confirm_all', 'allow_auto_decide', 'revise']).optional(),
    providedValues: z.record(z.any()).optional(),
  }).optional(),
});

const createConversationSchema = z.object({
  title: z.string().optional(),
  type: z.enum(['general', 'analysis', 'design', 'code-check']),
});

const executeSchema = z.object({
  message: z.string().min(1).max(10000),
  conversationId: optionalIdSchema,
  traceId: optionalIdSchema,
  context: z.object({
    model: z.record(z.any()).optional(),
    modelFormat: z.string().optional(),
    analysisType: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']).optional(),
    parameters: z.record(z.any()).optional(),
    autoAnalyze: z.boolean().optional(),
    autoCodeCheck: z.boolean().optional(),
    designCode: z.string().optional(),
    codeCheckElements: z.array(z.string()).optional(),
    includeReport: z.boolean().optional(),
    reportFormat: z.enum(['json', 'markdown', 'both']).optional(),
    reportOutput: z.enum(['inline', 'file']).optional(),
    userDecision: z.enum(['provide_values', 'confirm_all', 'allow_auto_decide', 'revise']).optional(),
    providedValues: z.record(z.any()).optional(),
  }).optional(),
});

const streamMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  mode: z.enum(['chat', 'execute', 'auto']).optional(),
  conversationId: optionalIdSchema,
  traceId: optionalIdSchema,
  context: z.object({
    projectId: z.string().optional(),
    model: z.record(z.any()).optional(),
    modelFormat: z.string().optional(),
    analysisType: z.enum(['static', 'dynamic', 'seismic', 'nonlinear']).optional(),
    parameters: z.record(z.any()).optional(),
    autoAnalyze: z.boolean().optional(),
    autoCodeCheck: z.boolean().optional(),
    designCode: z.string().optional(),
    codeCheckElements: z.array(z.string()).optional(),
    includeReport: z.boolean().optional(),
    reportFormat: z.enum(['json', 'markdown', 'both']).optional(),
    reportOutput: z.enum(['inline', 'file']).optional(),
    userDecision: z.enum(['provide_values', 'confirm_all', 'allow_auto_decide', 'revise']).optional(),
    providedValues: z.record(z.any()).optional(),
  }).optional(),
});

function setSseCorsHeaders(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin;

  if (!origin) {
    return;
  }

  if (!config.corsOrigins.includes(origin)) {
    return;
  }

  reply.raw.setHeader('Access-Control-Allow-Origin', origin);
  reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
  reply.raw.setHeader('Vary', 'Origin');
}

export async function chatRoutes(fastify: FastifyInstance) {
  // 发送消息
  fastify.post('/message', {
    schema: {
      tags: ['Chat'],
      summary: '发送消息给 AI 助手',
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          conversationId: { type: 'string' },
          traceId: { type: 'string' },
          context: { type: 'object' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof sendMessageSchema> }>, reply: FastifyReply) => {
    try {
      const body = sendMessageSchema.parse(request.body);
      const userId = request.user?.id;
      const mode = body.mode || 'auto';

      const shouldExecute = mode === 'execute'
        || (mode === 'auto' && (Boolean(body.context?.model) || agentService.shouldRouteToExecute(body.message)));

      if (shouldExecute) {
        const result = await agentService.run({
          message: body.message,
          mode: 'execute',
          conversationId: body.conversationId,
          traceId: body.traceId,
          context: {
            model: body.context?.model,
            modelFormat: body.context?.modelFormat,
            analysisType: body.context?.analysisType,
            parameters: body.context?.parameters,
            autoAnalyze: body.context?.autoAnalyze,
            autoCodeCheck: body.context?.autoCodeCheck,
            designCode: body.context?.designCode,
            codeCheckElements: body.context?.codeCheckElements,
            includeReport: body.context?.includeReport,
            reportFormat: body.context?.reportFormat,
            reportOutput: body.context?.reportOutput,
            userDecision: body.context?.userDecision,
            providedValues: body.context?.providedValues,
          },
        });
        return reply.send({
          mode: 'execute',
          result,
        });
      }

      const result = await chatService.sendMessage({
        message: body.message,
        conversationId: body.conversationId,
        userId,
        context: body.context,
      });

      return reply.send({
        mode: 'chat',
        result,
      });
    } catch (error) {
      const mappedError = toLlmApiError(error);
      if (isLlmTimeoutError(error)) {
        request.log.warn({
          err: error,
          llmProvider: config.llmProvider,
          llmModel: config.llmModel,
          llmTimeoutMs: config.llmTimeoutMs,
          llmMaxRetries: config.llmMaxRetries,
        }, 'LLM request timeout in /api/v1/chat/message');
      } else {
        request.log.error({ err: error }, 'Unexpected error in /api/v1/chat/message');
      }
      return reply.code(mappedError.statusCode).send(mappedError.body);
    }
  });

  // 创建会话
  fastify.post('/conversation', {
    schema: {
      tags: ['Chat'],
      summary: '创建新会话',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createConversationSchema> }>, reply: FastifyReply) => {
    const body = createConversationSchema.parse(request.body);
    const userId = request.user?.id;

    const conversation = await chatService.createConversation({
      title: body.title,
      type: body.type,
      userId,
    });

    return reply.send(conversation);
  });

  // 获取会话历史
  fastify.get('/conversation/:id', {
    schema: {
      tags: ['Chat'],
      summary: '获取会话历史',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user?.id;

    const conversation = await chatService.getConversation(id, userId);
    return reply.send(conversation);
  });

  // 获取用户所有会话
  fastify.get('/conversations', {
    schema: {
      tags: ['Chat'],
      summary: '获取用户所有会话',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.id;
    const conversations = await chatService.getUserConversations(userId);
    return reply.send(conversations);
  });

  // 流式响应 (SSE)
  fastify.post('/stream', {
    schema: {
      tags: ['Chat'],
      summary: '流式对话 (Server-Sent Events)',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof streamMessageSchema> }>, reply: FastifyReply) => {
    const body = streamMessageSchema.parse(request.body);
    const userId = request.user?.id;
    const mode = body.mode || 'auto';

    reply.hijack();
    setSseCorsHeaders(request, reply);
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders?.();

    const shouldExecute = mode === 'execute'
      || (mode === 'auto' && (Boolean(body.context?.model) || agentService.shouldRouteToExecute(body.message)));

    try {
      if (shouldExecute) {
        const stream = agentService.runStream({
          message: body.message,
          mode: 'execute',
          conversationId: body.conversationId,
          traceId: body.traceId,
          context: {
            model: body.context?.model,
            modelFormat: body.context?.modelFormat,
            analysisType: body.context?.analysisType,
            parameters: body.context?.parameters,
            autoAnalyze: body.context?.autoAnalyze,
            autoCodeCheck: body.context?.autoCodeCheck,
            designCode: body.context?.designCode,
            codeCheckElements: body.context?.codeCheckElements,
            includeReport: body.context?.includeReport,
            reportFormat: body.context?.reportFormat,
            reportOutput: body.context?.reportOutput,
            userDecision: body.context?.userDecision,
            providedValues: body.context?.providedValues,
          },
        });

        for await (const chunk of stream) {
          reply.raw.write(`data: ${JSON.stringify(normalizeStreamChunkError(chunk))}\n\n`);
        }
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }

      const stream = await chatService.streamMessage({
        message: body.message,
        conversationId: body.conversationId,
        userId,
        context: {
          projectId: body.context?.projectId,
          analysisType: body.context?.analysisType,
        },
      });

      for await (const chunk of stream) {
        reply.raw.write(`data: ${JSON.stringify(normalizeStreamChunkError(chunk))}\n\n`);
      }

      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    } catch (error) {
      request.log.error({ err: error }, 'Unexpected error in /api/v1/chat/stream');
      reply.raw.write(`data: ${JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'stream failed',
      })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    }
  });

  // 执行模式：复用 Agent 工具编排链路
  fastify.post('/execute', {
    schema: {
      tags: ['Chat'],
      summary: '执行结构化任务（Agent 工具编排）',
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          conversationId: { type: 'string' },
          traceId: { type: 'string' },
          context: { type: 'object' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof executeSchema> }>, reply: FastifyReply) => {
    const body = executeSchema.parse(request.body);
    const result = await agentService.run(body);
    return reply.send(result);
  });
}

function normalizeStreamChunkError(chunk: unknown): unknown {
  if (!chunk || typeof chunk !== 'object') {
    return chunk;
  }

  const value = chunk as { type?: string; error?: string; code?: string; retriable?: boolean };
  if (value.type !== 'error' || !value.error) {
    return chunk;
  }

  if (isLlmTimeoutError(value.error)) {
    return {
      ...value,
      code: 'LLM_TIMEOUT',
      retriable: true,
    };
  }

  return {
    ...value,
    code: value.code || 'INTERNAL_ERROR',
    retriable: value.retriable ?? false,
  };
}
