import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ConversationService } from '../services/conversation.js';
import { AgentService } from '../services/agent.js';
import { config } from '../config/index.js';
import { isLlmTimeoutError, toLlmApiError } from '../utils/llm-error.js';
import { prisma } from '../utils/database.js';

const conversationService = new ConversationService();
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

const localeSchema = z.enum(['en', 'zh']).optional();

// 请求验证
const sendMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  conversationId: optionalIdSchema,
  traceId: optionalIdSchema,
  context: z.object({
    locale: localeSchema,
    projectId: z.string().optional(),
    skillIds: z.array(z.string()).optional(),
    enabledToolIds: z.array(z.string()).optional(),
    disabledToolIds: z.array(z.string()).optional(),
    engineId: z.string().optional(),
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
  locale: localeSchema,
});

const conversationDetailQuerySchema = z.object({
  locale: localeSchema,
});

const streamMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  conversationId: optionalIdSchema,
  traceId: optionalIdSchema,
  context: z.object({
    locale: localeSchema,
    projectId: z.string().optional(),
    skillIds: z.array(z.string()).optional(),
    enabledToolIds: z.array(z.string()).optional(),
    disabledToolIds: z.array(z.string()).optional(),
    engineId: z.string().optional(),
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

async function persistLatestConversationResult(params: {
  conversationId?: string;
  userId?: string;
  latestResult: unknown;
}): Promise<void> {
  const conversationId = params.conversationId?.trim();
  if (!conversationId) {
    return;
  }

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: params.userId },
      select: { id: true },
    });

    if (!conversation) {
      return;
    }

    const latestResult =
      params.latestResult && typeof params.latestResult === 'object' && !Array.isArray(params.latestResult)
        ? (params.latestResult as Record<string, unknown>)
        : { response: String(params.latestResult ?? ''), success: false };

    await conversationService.saveConversationSnapshot({
      conversationId: conversation.id,
      latestResult,
    });
  } catch (error) {
    console.warn('[chat] skip latestResult persistence:', error instanceof Error ? error.message : String(error));
  }
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
      const result = await agentService.run({
        ...body,
        userId,
      });
      await persistLatestConversationResult({
        conversationId: result.conversationId,
        userId,
        latestResult: result,
      });
      return reply.send({ result });
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

    const conversation = await conversationService.createConversation({
      title: body.title,
      type: body.type,
      userId,
      locale: body.locale,
    });

    return reply.send(conversation);
  });

  // 获取会话历史
  fastify.get('/conversation/:id', {
    schema: {
      tags: ['Chat'],
      summary: '获取会话历史',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: z.infer<typeof conversationDetailQuerySchema> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const query = conversationDetailQuerySchema.parse(request.query);
    const userId = request.user?.id;

    const conversation = await conversationService.getConversation(id, userId);
    if (!conversation) {
      return reply.send(conversation);
    }

    const session = await agentService.getConversationSessionSnapshot(id, query.locale || 'en');
    const snapshots = await conversationService.getConversationSnapshot(id);
    return reply.send({
      ...conversation,
      session,
      snapshots,
    });
  });

  // 获取用户所有会话
  fastify.get('/conversations', {
    schema: {
      tags: ['Chat'],
      summary: '获取用户所有会话',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.id;
    const conversations = await conversationService.getUserConversations(userId);
    return reply.send(conversations);
  });

  fastify.delete('/conversation/:id', {
    schema: {
      tags: ['Chat'],
      summary: '删除会话',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user?.id;

    const deleted = await conversationService.deleteConversation(id, userId);
    if (!deleted) {
      return reply.code(404).send({
        error: 'Conversation not found',
      });
    }

    await agentService.clearConversationSession(id);
    return reply.send({
      success: true,
      id,
    });
  });

  // 保存会话快照
  const saveSnapshotSchema = z.object({
    modelSnapshot: z.record(z.any()).nullable().optional(),
    resultSnapshot: z.record(z.any()).nullable().optional(),
    latestResult: z.record(z.any()).nullable().optional(),
  });

  fastify.post('/conversation/:id/snapshot', {
    schema: {
      tags: ['Chat'],
      summary: '保存会话快照',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof saveSnapshotSchema> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = saveSnapshotSchema.parse(request.body);
    const userId = request.user?.id;

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId },
    });

    if (!conversation) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }

    await conversationService.saveConversationSnapshot({
      conversationId: id,
      modelSnapshot: body.modelSnapshot,
      resultSnapshot: body.resultSnapshot,
      latestResult: body.latestResult,
    });

    return reply.send({ success: true });
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
    let streamConversationId = body.conversationId;

    reply.hijack();
    setSseCorsHeaders(request, reply);
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders?.();

    try {
      const stream = agentService.runStream({
        ...body,
        userId,
      });

      for await (const chunk of stream) {
        if (
          chunk
          && typeof chunk === 'object'
          && (chunk as { type?: string }).type === 'start'
          && (chunk as { content?: { conversationId?: string } }).content?.conversationId
        ) {
          streamConversationId = (chunk as { content: { conversationId: string } }).content.conversationId;
        }
        if (
          chunk
          && typeof chunk === 'object'
          && (chunk as { type?: string }).type === 'result'
        ) {
          await persistLatestConversationResult({
            conversationId: streamConversationId,
            userId,
            latestResult: (chunk as { content?: unknown }).content,
          });
        }
        reply.raw.write(`data: ${JSON.stringify(normalizePublicStreamChunk(chunk))}\n\n`);
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

}

function normalizePublicStreamChunk(chunk: unknown): unknown {
  if (!chunk || typeof chunk !== 'object') {
    return chunk;
  }

  const raw = chunk as { type?: string; error?: string; code?: string; retriable?: boolean; content?: unknown };
  const value = raw.type && raw.content && typeof raw.content === 'object' && !Array.isArray(raw.content)
    ? raw
    : raw;

  if (value.type !== 'error' || !value.error) {
    return value;
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
