import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ConversationService } from '../services/conversation.js';
import { AgentService } from '../services/agent.js';
import { config } from '../config/index.js';
import { isLlmTimeoutError, toLlmApiError } from '../utils/llm-error.js';
import { prisma } from '../utils/database.js';
import type { InputJsonValue } from '../utils/json.js';

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
    resumeFromMessage: z.string().max(10000).optional(),
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
    resumeFromMessage: z.string().max(10000).optional(),
  }).optional(),
});

const persistMessagesSchema = z.object({
  userMessage: z.string().min(1).max(10000),
  assistantContent: z.string().max(10000).default(''),
  assistantAborted: z.boolean().optional(),
  traceId: optionalIdSchema,
});

function toMessageMetadata(value: Record<string, unknown> | undefined): InputJsonValue | undefined {
  if (!value || Object.keys(value).length === 0) {
    return undefined;
  }
  return value as InputJsonValue;
}

function getPersistedMessageTraceId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const traceId = (metadata as Record<string, unknown>).traceId;
  return typeof traceId === 'string' && traceId.trim().length > 0 ? traceId : undefined;
}

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

function buildEffectiveAgentMessage(message: string, resumeFromMessage?: string): string {
  const normalizedMessage = message.trim();
  const normalizedResume = typeof resumeFromMessage === 'string' ? resumeFromMessage.trim() : '';

  if (!normalizedResume || normalizedResume === normalizedMessage) {
    return normalizedMessage;
  }

  return `${normalizedResume}\n\n${normalizedMessage}`;
}

function buildPersistedDebugDetails(params: {
  userMessage: string;
  context?: z.infer<typeof sendMessageSchema>['context'];
  result: unknown;
}): Record<string, unknown> | undefined {
  const resultRecord = params.result && typeof params.result === 'object' && !Array.isArray(params.result)
    ? params.result as Record<string, unknown>
    : null;
  if (!resultRecord) {
    return undefined;
  }

  const skillIds = Array.isArray(params.context?.skillIds)
    ? params.context.skillIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const toolIds = Array.isArray(params.context?.enabledToolIds)
    ? params.context.enabledToolIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const routing = resultRecord.routing && typeof resultRecord.routing === 'object' && !Array.isArray(resultRecord.routing)
    ? resultRecord.routing as Record<string, unknown>
    : undefined;
  const plan = Array.isArray(resultRecord.plan)
    ? resultRecord.plan.filter((value): value is string => typeof value === 'string')
    : [];
  const toolCalls = Array.isArray(resultRecord.toolCalls) ? resultRecord.toolCalls : [];

  if (
    skillIds.length === 0
    && toolIds.length === 0
    && !routing
    && plan.length === 0
    && toolCalls.length === 0
    && typeof resultRecord.response !== 'string'
  ) {
    return undefined;
  }

  // Build a compact context snapshot, omitting large fields like model/parameters
  // to avoid DB bloat.
  const compactContext: Record<string, unknown> = {};
  if (params.context?.locale) compactContext.locale = params.context.locale;
  if (params.context?.skillIds) compactContext.skillIds = params.context.skillIds;
  if (params.context?.enabledToolIds) compactContext.enabledToolIds = params.context.enabledToolIds;
  if (params.context?.engineId) compactContext.engineId = params.context.engineId;

  return {
    promptSnapshot: JSON.stringify({
      message: params.userMessage,
      context: compactContext,
    }, null, 2),
    skillIds,
    toolIds,
    routing,
    responseSummary: typeof resultRecord.response === 'string' ? resultRecord.response : '',
    plan,
    toolCalls,
  };
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

async function persistConversationMessages(params: {
  conversationId?: string;
  userId?: string;
  userMessage: string;
  assistantContent: string;
  assistantAborted?: boolean;
  traceId?: string;
  assistantMetadata?: Record<string, unknown>;
}): Promise<void> {
  const conversationId = params.conversationId?.trim();
  const userMessage = params.userMessage.trim();
  const assistantContent = params.assistantContent.length > 10000
    ? params.assistantContent.slice(0, 10000)
    : params.assistantContent;
  const shouldPersistAssistant = assistantContent.trim().length > 0 || Boolean(params.assistantAborted);

  if (!conversationId) {
    return;
  }
  if (!userMessage || !shouldPersistAssistant) {
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

    if (params.traceId) {
      const recentMessages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { metadata: true },
      });
      if (recentMessages.some((message) => getPersistedMessageTraceId(message.metadata) === params.traceId)) {
        return;
      }
    }

    await prisma.message.createMany({
      data: [
        {
          conversationId,
          role: 'user',
          content: userMessage,
          metadata: toMessageMetadata(params.traceId ? { traceId: params.traceId } : undefined),
        },
        {
          conversationId,
          role: 'assistant',
          content: assistantContent,
          metadata: toMessageMetadata({
            ...(params.assistantMetadata ? params.assistantMetadata : {}),
            ...(params.traceId ? { traceId: params.traceId } : {}),
            ...(params.assistantAborted ? { status: 'aborted' } : {}),
          }),
        },
      ],
    });
  } catch (error) {
    console.warn('[chat] skip message persistence:', error instanceof Error ? error.message : String(error));
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
      const effectiveMessage = buildEffectiveAgentMessage(body.message, body.context?.resumeFromMessage);
      const result = await agentService.run({
        ...body,
        message: effectiveMessage,
        userId,
      });
      await persistLatestConversationResult({
        conversationId: result.conversationId,
        userId,
        latestResult: result,
      });
      const assistantText = result.response || result.clarification?.question || '';
      const debugDetails = buildPersistedDebugDetails({
        userMessage: body.message,
        context: body.context,
        result,
      });
      await persistConversationMessages({
        conversationId: result.conversationId,
        userId,
        userMessage: body.message,
        assistantContent: assistantText,
        traceId: body.traceId,
        assistantMetadata: debugDetails ? { debugDetails } : undefined,
      });
      return reply.send({ result });
    } catch (error) {
      const mappedError = toLlmApiError(error);
      if (isLlmTimeoutError(error)) {
        request.log.warn({
          err: error,
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

  fastify.post('/conversation/:id/messages', {
    schema: {
      tags: ['Chat'],
      summary: '保存会话消息',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof persistMessagesSchema> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = persistMessagesSchema.parse(request.body);
    const userId = request.user?.id;

    await persistConversationMessages({
      conversationId: id,
      userId,
      userMessage: body.userMessage,
      assistantContent: body.assistantContent,
      assistantAborted: body.assistantAborted,
      traceId: body.traceId,
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
    const effectiveMessage = buildEffectiveAgentMessage(body.message, body.context?.resumeFromMessage);

    reply.hijack();
    setSseCorsHeaders(request, reply);
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders?.();

    const abortController = new AbortController();
    const onClose = () => { abortController.abort(); };
    // Listen on both reply.raw and request.socket to reliably detect
    // client disconnect. reply.raw 'close' may not fire on all Node.js
    // versions; request.socket 'close' fires when the TCP socket closes.
    reply.raw.on('close', onClose);
    request.socket.on('close', onClose);

    let assistantContent = '';
    let assistantMetadata: Record<string, unknown> | undefined;
    let messagesPersisted = false;
    let streamTraceId = body.traceId;

    const persistStreamMessages = async (assistantAborted?: boolean) => {
      if (messagesPersisted) {
        return;
      }
      await persistConversationMessages({
        conversationId: streamConversationId,
        userId,
        userMessage: body.message,
        assistantContent,
        assistantAborted,
        traceId: streamTraceId,
        assistantMetadata,
      });
      messagesPersisted = true;
    };

    try {
      const stream = agentService.runStream({
        ...body,
        message: effectiveMessage,
        userId,
        signal: abortController.signal,
      });

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        if (
          chunk
          && typeof chunk === 'object'
          && (chunk as { type?: string }).type === 'start'
          && (chunk as { content?: { conversationId?: string } }).content?.conversationId
        ) {
          const startContent = (chunk as { content: { conversationId: string; traceId?: string } }).content;
          streamConversationId = startContent.conversationId;
          if (startContent.traceId) streamTraceId = startContent.traceId;
        }
        if (
          chunk
          && typeof chunk === 'object'
          && (chunk as { type?: string }).type === 'token'
          && typeof (chunk as { content?: unknown }).content === 'string'
        ) {
          assistantContent += (chunk as { content: string }).content;
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
          const resultContent = (chunk as { content?: { response?: string; clarification?: { question?: string } } }).content;
          if (resultContent?.response) {
            assistantContent = resultContent.response;
          } else if (resultContent?.clarification?.question) {
            assistantContent = resultContent.clarification.question;
          }
          const debugDetails = buildPersistedDebugDetails({
            userMessage: body.message,
            context: body.context,
            result: resultContent,
          });
          assistantMetadata = debugDetails ? { debugDetails } : undefined;
        }
        if (
          chunk
          && typeof chunk === 'object'
          && (chunk as { type?: string }).type === 'interaction_update'
          && (chunk as { content?: { guidanceText?: string } }).content?.guidanceText
        ) {
          assistantContent = (chunk as { content: { guidanceText: string } }).content.guidanceText;
        }
        reply.raw.write(`data: ${JSON.stringify(normalizePublicStreamChunk(chunk))}\n\n`);
      }

      // Save user + assistant messages to DB so the next request has context.
      // This runs for both completed and aborted streams.
      const wasAborted = abortController.signal.aborted;
      await persistStreamMessages(wasAborted);

      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    } catch (error) {
      if (abortController.signal.aborted) {
        request.log.info({ conversationId: streamConversationId }, 'Stream aborted by client');
        reply.raw.end();
      } else {
        request.log.error({ err: error }, 'Unexpected error in /api/v1/chat/stream');
        reply.raw.write(`data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'stream failed',
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      }
    } finally {
      // Ensure messages are persisted even on unexpected errors.
      await persistStreamMessages(abortController.signal.aborted).catch(() => {});
      reply.raw.off('close', onClose);
      request.socket.off('close', onClose);
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
