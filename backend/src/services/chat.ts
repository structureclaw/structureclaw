import { ChatOpenAI } from '@langchain/openai';
import { ConversationChain } from 'langchain/chains';
import { BufferMemory } from 'langchain/memory';
import { PromptTemplate } from '@langchain/core/prompts';
import { config } from '../config/index.js';
import { createChatModel } from '../utils/llm.js';
import { isLlmTimeoutError, toLlmApiError } from '../utils/llm-error.js';
import { prisma } from '../utils/database.js';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { resolveLocale, type AppLocale } from './locale.js';

function getStructuralEngineerSystemPrompt(locale: AppLocale): string {
  if (locale === 'zh') {
    return `你是一位专业的建筑结构工程师和顾问，专注于结构分析、设计和规范解读。

你的专业领域包括：
1. 结构分析方法：静力分析、动力分析、非线性分析、稳定性分析
2. 结构设计：混凝土结构、钢结构、组合结构、砌体结构
3. 规范解读：中国规范（GB系列）、国际规范
4. 地震工程：抗震设计、动力时程分析、Pushover分析
5. 荷载计算：恒载、活载、风荷载、地震作用
6. 有限元分析：建模技巧、网格划分、边界条件设置

回答问题时请：
- 使用专业的结构工程术语
- 提供具体的计算公式和方法
- 引用相关规范条文
- 给出实用建议和注意事项
- 如需进一步信息，主动询问

当前对话上下文：
{chat_history}

用户问题：{input}

请提供专业、准确、实用的回答：`;
  }

  return `You are a professional structural engineering consultant focused on structural analysis, design, and code interpretation.

Your areas of expertise include:
1. Structural analysis methods: static, dynamic, nonlinear, and stability analysis
2. Structural design: concrete, steel, composite, and masonry systems
3. Code interpretation: Chinese GB series and international standards
4. Earthquake engineering: seismic design, time-history analysis, and pushover analysis
5. Load assessment: dead, live, wind, and seismic loads
6. Finite element modeling: modeling strategy, mesh quality, and boundary conditions

When responding:
- Use precise structural engineering terminology
- Provide formulas, methods, or checks where relevant
- Cite applicable code concepts or clauses when possible
- Give practical recommendations and caveats
- Ask for more information proactively when needed

Conversation context:
{chat_history}

User question: {input}

Provide a professional, accurate, and practical answer:`;
}

function getMissingConversationError(locale: AppLocale): string {
  return locale === 'zh' ? '会话不存在' : 'Conversation not found';
}

function getChatFallbackResponse(locale: AppLocale): string {
  return locale === 'zh'
    ? 'AI 聊天功能未配置 LLM API Key（支持 OPENAI_API_KEY/LLM_API_KEY/ZAI_API_KEY），其余 API 服务可正常使用。'
    : 'AI chat is unavailable because no LLM API key is configured (OPENAI_API_KEY/LLM_API_KEY/ZAI_API_KEY are supported). Other API features remain available.';
}

function getDefaultConversationTitle(locale: AppLocale): string {
  return locale === 'zh' ? '新对话' : 'New Conversation';
}

function buildChatInput(message: string, projectContext: string, locale: AppLocale): string {
  if (!projectContext) {
    return message;
  }

  return locale === 'zh'
    ? `[项目上下文]\n${projectContext}\n\n[用户问题]\n${message}`
    : `[Project Context]\n${projectContext}\n\n[User Question]\n${message}`;
}

export interface SendMessageParams {
  message: string;
  conversationId?: string;
  userId?: string;
  context?: {
    locale?: AppLocale;
    projectId?: string;
    analysisType?: string;
  };
}

export interface StreamChunk {
  type: 'token' | 'done' | 'error';
  content?: string;
  error?: string;
  code?: string;
  retriable?: boolean;
}

export class ChatService {
  private llm: ChatOpenAI | null;
  private memories: Map<string, BufferMemory>;

  constructor() {
    this.llm = createChatModel(0.3);
    this.memories = new Map();
  }

  async sendMessage(params: SendMessageParams) {
    const { message, conversationId, userId, context } = params;
    const locale = resolveLocale(context?.locale);

    // 获取或创建会话
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
    } else {
      conversation = await prisma.conversation.create({
        data: {
          title: message.slice(0, 50),
          type: 'general',
          userId,
        },
        include: { messages: true },
      });
    }

    if (!conversation) {
      throw new Error(getMissingConversationError(locale));
    }

    // 获取记忆
    const memory = this.getMemory(conversation.id);

    // 构建上下文
    const projectContext = context?.projectId
      ? await this.getProjectContext(context.projectId, locale)
      : '';

    if (!this.llm) {
      const fallbackResponse = getChatFallbackResponse(locale);

      await prisma.message.createMany({
        data: [
          {
            conversationId: conversation.id,
            role: 'user',
            content: message,
          },
          {
            conversationId: conversation.id,
            role: 'assistant',
            content: fallbackResponse,
          },
        ],
      });

      return {
        conversationId: conversation.id,
        response: fallbackResponse,
      };
    }

    // 创建对话链
    const prompt = PromptTemplate.fromTemplate(getStructuralEngineerSystemPrompt(locale));
    const chain = new ConversationChain({
      llm: this.llm,
      memory,
      prompt,
    });

    // 发送消息并获取响应
    const response = await chain.invoke({
      input: buildChatInput(message, projectContext, locale),
    });

    // 保存消息
    await prisma.message.createMany({
      data: [
        {
          conversationId: conversation.id,
          role: 'user',
          content: message,
        },
        {
          conversationId: conversation.id,
          role: 'assistant',
          content: response.response,
        },
      ],
    });

    return {
      conversationId: conversation.id,
      response: response.response,
    };
  }

  async *streamMessage(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    const { message, conversationId, userId, context } = params;
    const locale = resolveLocale(context?.locale);

    try {
      // 获取或创建会话
      let conversation;
      if (conversationId) {
        conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
        });
      } else {
        conversation = await prisma.conversation.create({
          data: {
            title: message.slice(0, 50),
            type: 'general',
            userId,
          },
        });
      }

      if (!conversation) {
        throw new Error(getMissingConversationError(locale));
      }

      if (!this.llm) {
        const fallbackResponse = getChatFallbackResponse(locale);

        await prisma.message.createMany({
          data: [
            {
              conversationId: conversation.id,
              role: 'user',
              content: message,
            },
            {
              conversationId: conversation.id,
              role: 'assistant',
              content: fallbackResponse,
            },
          ],
        });

        yield { type: 'token', content: fallbackResponse };
        yield { type: 'done' };
        return;
      }

      // 使用流式 API
      const projectContext = context?.projectId
        ? await this.getProjectContext(context.projectId, locale)
        : '';
      const stream = await this.llm.stream(buildChatInput(message, projectContext, locale));
      let fullResponse = '';

      for await (const chunk of stream) {
        const token = typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
        fullResponse += token;
        yield { type: 'token', content: token };
      }

      // 保存消息
      await prisma.message.createMany({
        data: [
          {
            conversationId: conversation.id,
            role: 'user',
            content: message,
          },
          {
            conversationId: conversation.id,
            role: 'assistant',
            content: fullResponse,
          },
        ],
      });

      yield { type: 'done' };
    } catch (error: any) {
      const mappedError = toLlmApiError(error);
      if (isLlmTimeoutError(error)) {
        logger.warn({
          err: error,
          llmProvider: config.llmProvider,
          llmModel: config.llmModel,
          llmTimeoutMs: config.llmTimeoutMs,
          llmMaxRetries: config.llmMaxRetries,
        }, 'LLM request timeout in chat stream');
      } else {
        logger.error({ err: error }, 'Unexpected error in chat stream');
      }
      yield {
        type: 'error',
        error: mappedError.body.error.message,
        code: mappedError.body.error.code,
        retriable: mappedError.body.error.retriable,
      };
    }
  }

  async createConversation(params: { title?: string; type: string; userId?: string; locale?: AppLocale }) {
    const locale = resolveLocale(params.locale);
    return prisma.conversation.create({
      data: {
        title: params.title || getDefaultConversationTitle(locale),
        type: params.type,
        userId: params.userId,
      },
    });
  }

  async getConversation(id: string, userId?: string) {
    return prisma.conversation.findFirst({
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async getUserConversations(userId?: string) {
    return prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async deleteConversation(id: string, userId?: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!conversation) {
      return null;
    }

    await prisma.conversation.delete({
      where: { id: conversation.id },
    });

    return conversation;
  }

  async saveConversationSnapshot(params: {
    conversationId: string;
    modelSnapshot?: Record<string, unknown> | null;
    resultSnapshot?: Record<string, unknown> | null;
    latestResult?: Record<string, unknown> | null;
  }): Promise<void> {
    const updateData: any = { updatedAt: new Date() };

    if (params.modelSnapshot !== undefined) {
      updateData.modelSnapshot = params.modelSnapshot;
    }
    if (params.resultSnapshot !== undefined) {
      updateData.resultSnapshot = params.resultSnapshot;
    }
    if (params.latestResult !== undefined) {
      updateData.latestResult = params.latestResult;
    }

    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: updateData,
    });
  }

  async getConversationSnapshot(conversationId: string): Promise<{
    modelSnapshot?: Prisma.JsonValue | null;
    resultSnapshot?: Prisma.JsonValue | null;
    latestResult?: Prisma.JsonValue | null;
  } | null> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        modelSnapshot: true,
        resultSnapshot: true,
        latestResult: true,
      },
    });

    if (!conversation) return null;

    return {
      modelSnapshot: conversation.modelSnapshot,
      resultSnapshot: conversation.resultSnapshot,
      latestResult: conversation.latestResult,
    };
  }

  private getMemory(conversationId: string): BufferMemory {
    if (!this.memories.has(conversationId)) {
      this.memories.set(
        conversationId,
        new BufferMemory({
          returnMessages: true,
          memoryKey: 'chat_history',
        })
      );
    }
    return this.memories.get(conversationId)!;
  }

  private async getProjectContext(projectId: string, locale: AppLocale): Promise<string> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        models: {
          include: {
            analyses: {
              take: 5,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!project) return '';

    const analysisCount = project.models.reduce((count: number, model: { analyses: unknown[] }) => {
      return count + model.analyses.length;
    }, 0);

    const projectSettings = (project.settings || {}) as { designCode?: string };

    if (locale === 'zh') {
      return `
项目名称: ${project.name}
项目类型: ${project.type}
设计规范: ${projectSettings.designCode || '未指定'}
模型数量: ${project.models?.length || 0}
分析任务: ${analysisCount}
      `.trim();
    }

    return `
Project Name: ${project.name}
Project Type: ${project.type}
Design Code: ${projectSettings.designCode || 'Not specified'}
Model Count: ${project.models?.length || 0}
Analysis Runs: ${analysisCount}
    `.trim();
  }
}
