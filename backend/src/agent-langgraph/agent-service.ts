/**
 * LangGraph-based AgentService — the sole agent implementation.
 *
 * Provides streaming, synchronous, and resumption entry points for the
 * LangGraph ReAct agent, plus conversation/session management methods.
 *
 * Dependency injection uses config.configurable (no globalThis).
 * The graph is built once and cached for the process lifetime.
 */
import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { SkillManifest } from '../agent-runtime/types.js';
import { buildAgentGraph } from './graph.js';
import { FileCheckpointer } from './file-checkpointer.js';
import { streamGraphToChunks, type StreamContext } from './streaming.js';
import { type AgentState } from './state.js';
import { getAllowShellTools, getCheckpointerDataDir, getWorkspaceRoot, getWorkspaceSkillRoot } from './config.js';
import { config } from '../config/index.js';
import type { AgentStreamChunk } from '../types/agent-stream.js';
import type { AppLocale } from '../services/locale.js';
import { createLocalAnalysisEngineClient } from '../services/analysis-execution.js';
import { createLocalCodeCheckClient } from '../services/code-check-execution.js';
import { createLocalStructureProtocolClient } from '../services/structure-protocol-execution.js';
import { prisma } from '../utils/database.js';
import { Command } from '@langchain/langgraph';
import { logger } from '../utils/logger.js';
import { createAgentLogger } from '../utils/agent-logger.js';
import type { AgentConfigurable } from './configurable.js';
import { listAgentToolDefinitions } from './tool-registry.js';
import { analyzeUploadedFile } from './file-tools.js';
import { createVisionChatModel } from '../utils/llm.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttachmentInfo {
  fileId: string;
  originalName: string;
  relPath: string;
  mimeType?: string;
}

export interface LangGraphRunInput {
  message: string;
  conversationId?: string;
  traceId?: string;
  signal?: AbortSignal;
  context?: {
    locale?: AppLocale;
    skillIds?: string[];
    enabledToolIds?: string[];
    disabledToolIds?: string[];
    model?: Record<string, unknown>;
    analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    engineId?: string;
    designCode?: string;
    includeReport?: boolean;
    seismicWorkflow?: Record<string, unknown>;
    attachments?: AttachmentInfo[];
  };
}

export interface LangGraphRunResult {
  conversationId: string;
  traceId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  response: string;
  mode: 'conversation' | 'execution';
  toolCalls: unknown[];
  model?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  report?: Record<string, unknown>;
  draftState?: Record<string, unknown>;
  presentation?: Record<string, unknown>;
}

type HumanMessageContentBlock =
  | { type: 'text'; text: string };

interface InitialHumanMessagePayload {
  content: string | HumanMessageContentBlock[];
  canonicalMessage: string;
  attachmentAnalyses: AttachmentAnalysis[];
}

interface InitialHumanMessageOptions {
  summarizeImages?: boolean;
  signal?: AbortSignal;
}

export interface AttachmentAnalysis {
  attachment: AttachmentInfo;
  analysis: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getLangGraphRecursionLimit(maxToolCallsPerTurn: number | undefined): number {
  const toolLimit = typeof maxToolCallsPerTurn === 'number' && Number.isFinite(maxToolCallsPerTurn) && maxToolCallsPerTurn > 0
    ? maxToolCallsPerTurn
    : 200;
  return Math.max(50, toolLimit * 2 + 10);
}

function buildAttachmentBlock(attachments: AttachmentInfo[] | undefined, locale: AppLocale): string {
  if (!attachments || attachments.length === 0) return '';
  const header = locale === 'zh' ? '[已上传文件]' : '[Attached files]';
  const instruction = locale === 'zh'
    ? '下面会提供附件的解析内容。请基于已解析文本、DXF 几何或视觉摘要识别结构类型、尺寸、荷载和边界条件；如果关键信息缺失，请追问。'
    : 'Parsed attachment content follows. Use parsed text, DXF geometry, or vision summaries to identify structural type, dimensions, loads, and boundary conditions; ask for clarification when critical information is missing.';
  const lines = attachments.map(a => `- ${a.originalName} (${a.relPath})`);
  return `\n\n${header}\n${instruction}\n${lines.join('\n')}`;
}

function sanitizeAttachmentNote(note: string): string {
  return note.replace(/\bbase64DataUri\b/g, 'image binary data');
}

function compactAttachmentAnalysis(analysis: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...analysis };
  delete rest.base64DataUri;
  if (rest.type === 'image') {
    rest.note = typeof rest.note === 'string'
      ? sanitizeAttachmentNote(rest.note)
      : 'Image binary is parsed only by the configured vision model; the main agent receives text summaries only.';
  }
  return rest;
}

function compactAttachmentAnalysisMetadata(analysis: Record<string, unknown>): Record<string, unknown> {
  const rest = compactAttachmentAnalysis(analysis);
  delete rest.rows;
  delete rest.content;
  delete rest.text;
  delete rest.csv;
  delete rest.at2;
  delete rest.data;
  delete rest.sheets;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function attachmentSummary(attachment: AttachmentInfo): Record<string, unknown> {
  return {
    fileId: attachment.fileId,
    originalName: attachment.originalName,
    relPath: attachment.relPath,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
  };
}

function analysisRowsRecord(
  attachment: AttachmentInfo,
  analysis: Record<string, unknown>,
  idSuffix?: string,
): Record<string, unknown> | null {
  const rows = analysis.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const sheetLabel = idSuffix ? `:${idSuffix}` : '';
  return {
    id: `${attachment.fileId || attachment.relPath || attachment.originalName}${sheetLabel}`,
    name: idSuffix ? `${attachment.originalName}:${idSuffix}` : attachment.originalName,
    recordType: 'actual',
    source: 'uploaded_attachment',
    fileId: attachment.fileId,
    relPath: attachment.relPath,
    ...(idSuffix ? { sheetName: idSuffix } : {}),
    ...(Array.isArray(analysis.headers) ? { headers: analysis.headers } : {}),
    rows,
    fileAnalysis: compactAttachmentAnalysisMetadata(analysis),
  };
}

function finiteCellNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numericRows(rows: unknown): number[][] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => Array.isArray(row)
      ? row.map(finiteCellNumber).filter((value): value is number => value !== null)
      : [])
    .filter((row) => row.length > 0);
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function isNumericHeaderRow(headers: unknown): boolean {
  return Array.isArray(headers)
    && headers.length > 0
    && headers.every((header) => finiteCellNumber(header) !== null);
}

function hasMotionHeaders(headers: unknown): boolean {
  if (!Array.isArray(headers)) return false;
  const normalized = headers.map(normalizeHeader);
  const hasTime = normalized.some((header) =>
    ['time', 't', 'sec', 'second', 'seconds'].includes(header)
    || header.includes('time')
    || header.includes('(s)'));
  const hasAcceleration = normalized.some((header) =>
    ['acc', 'ag', 'a', 'gal', 'g'].includes(header)
    || header.includes('accel')
    || header.includes('acceler')
    || header.includes('cm/s')
    || header.includes('m/s'));
  return hasTime && hasAcceleration;
}

function hasClearlyNonMotionHeaders(headers: unknown): boolean {
  if (!Array.isArray(headers)) return false;
  const normalized = headers.map(normalizeHeader).join(' ');
  return [
    'story',
    'floor',
    'load',
    'force',
    'node',
    'element',
    'member',
    'beam',
    'column',
    'region',
    'intensity',
    'designgroup',
    'design group',
    'sitecategory',
    'site category',
    'alphamax',
    'alpha max',
    'characteristicperiod',
  ].some((token) => normalized.includes(token));
}

function hasLikelyGroundMotionTimeColumn(rows: number[][]): boolean {
  const timeValues = rows
    .filter((row) => row.length >= 2)
    .map((row) => row[0]);
  if (timeValues.length < 3) return false;
  const deltas = timeValues.slice(1).map((value, index) => value - timeValues[index]);
  return deltas.every((delta) => delta > 0 && delta <= 0.5);
}

function looksLikeGroundMotionRows(analysis: Record<string, unknown>): boolean {
  const rows = numericRows(analysis.rows);
  if (rows.length < 3) return false;
  if (hasMotionHeaders(analysis.headers)) return rows.some((row) => row.length >= 2);
  if (hasClearlyNonMotionHeaders(analysis.headers)) return false;
  if (!isNumericHeaderRow(analysis.headers)) return false;
  if (rows.every((row) => row.length === 1)) return rows.length >= 8;
  return hasLikelyGroundMotionTimeColumn(rows);
}

function looksLikeGroundMotionText(analysis: Record<string, unknown>): boolean {
  const ext = typeof analysis.ext === 'string' ? analysis.ext.toLowerCase() : '';
  const content = typeof analysis.content === 'string' ? analysis.content : '';
  if (!content.trim()) return false;
  if (ext === '.at2') return true;
  if (ext !== '.txt') return false;
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const numericLines = lines.filter((line) => {
    const values = line.split(/[\s,;]+/).map(finiteCellNumber).filter((value) => value !== null);
    return values.length > 0 && values.length === line.split(/[\s,;]+/).filter(Boolean).length;
  });
  return numericLines.length >= 4 && numericLines.length >= Math.ceil(lines.length * 0.5);
}

function looksLikeGroundMotionAttachmentAnalysis(analysis: Record<string, unknown>): boolean {
  const type = typeof analysis.type === 'string' ? analysis.type : '';
  if (type === 'csv') return looksLikeGroundMotionRows(analysis);
  if (type === 'text') return looksLikeGroundMotionText(analysis);
  if (type === 'excel' && isRecord(analysis.sheets)) {
    return Object.values(analysis.sheets).some((sheetValue) =>
      isRecord(sheetValue) && looksLikeGroundMotionRows(sheetValue));
  }
  return false;
}

function groundMotionAttachmentAnalyses(
  attachmentAnalyses: AttachmentAnalysis[],
): AttachmentAnalysis[] {
  return attachmentAnalyses.filter(({ analysis }) => looksLikeGroundMotionAttachmentAnalysis(analysis));
}

function groundMotionRecordsFromAttachmentAnalyses(attachmentAnalyses: AttachmentAnalysis[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const { attachment, analysis } of attachmentAnalyses) {
    const type = typeof analysis.type === 'string' ? analysis.type : '';
    if (type === 'csv') {
      const record = analysisRowsRecord(attachment, analysis);
      if (record) records.push(record);
      continue;
    }
    if (type === 'text') {
      const content = typeof analysis.content === 'string' ? analysis.content : '';
      if (content.trim()) {
        records.push({
          id: attachment.fileId || attachment.relPath || attachment.originalName,
          name: attachment.originalName,
          recordType: 'actual',
          source: 'uploaded_attachment',
          fileId: attachment.fileId,
          relPath: attachment.relPath,
          content,
          fileAnalysis: compactAttachmentAnalysisMetadata(analysis),
        });
      }
      continue;
    }
    if (type === 'excel' && isRecord(analysis.sheets)) {
      for (const [sheetName, sheetValue] of Object.entries(analysis.sheets)) {
        if (!isRecord(sheetValue)) continue;
        if (!looksLikeGroundMotionRows(sheetValue)) continue;
        const record = analysisRowsRecord(attachment, sheetValue, sheetName);
        if (record) {
          records.push({
            ...record,
            fileAnalysis: {
              ...compactAttachmentAnalysisMetadata(sheetValue),
              workbook: compactAttachmentAnalysisMetadata(analysis),
            },
          });
        }
      }
    }
  }
  return records;
}

function uploadedGroundMotionWorkflowFromAttachmentAnalyses(
  attachmentAnalyses: AttachmentAnalysis[],
): Record<string, unknown> | null {
  const groundMotionAnalyses = groundMotionAttachmentAnalyses(attachmentAnalyses);
  const records = groundMotionRecordsFromAttachmentAnalyses(groundMotionAnalyses);
  if (records.length === 0) {
    return null;
  }
  return {
    groundMotionSet: {
      source: 'uploaded',
      uploadedAttachments: groundMotionAnalyses.map(({ attachment }) => attachmentSummary(attachment)),
      records,
    },
  };
}

export function enrichUploadedGroundMotionWorkflow(
  seismicWorkflow: Record<string, unknown>,
  attachmentAnalyses: AttachmentAnalysis[],
): Record<string, unknown> {
  const groundMotionSet = isRecord(seismicWorkflow.groundMotionSet)
    ? seismicWorkflow.groundMotionSet
    : undefined;
  const source = typeof groundMotionSet?.source === 'string'
    ? groundMotionSet.source.trim().toLowerCase()
    : '';
  if (source !== 'uploaded' || !groundMotionSet) {
    return seismicWorkflow;
  }

  const groundMotionAnalyses = groundMotionAttachmentAnalyses(attachmentAnalyses);
  const uploadedAttachments = groundMotionAnalyses.map(({ attachment }) => attachmentSummary(attachment));
  const existingRecords = Array.isArray(groundMotionSet.records) ? groundMotionSet.records : undefined;
  const generatedRecords = existingRecords && existingRecords.length > 0
    ? existingRecords
    : groundMotionRecordsFromAttachmentAnalyses(groundMotionAnalyses);

  return {
    ...seismicWorkflow,
    groundMotionSet: {
      ...groundMotionSet,
      uploadedAttachments,
      ...(generatedRecords.length > 0 ? { records: generatedRecords } : {}),
    },
  };
}

export function extractContextSeismicWorkflow(
  context?: LangGraphRunInput['context'],
  attachmentAnalyses: AttachmentAnalysis[] = [],
): Record<string, unknown> | null {
  const seismicWorkflow = context?.seismicWorkflow;
  if (!isRecord(seismicWorkflow) || Object.keys(seismicWorkflow).length === 0) {
    return uploadedGroundMotionWorkflowFromAttachmentAnalyses(attachmentAnalyses);
  }
  return enrichUploadedGroundMotionWorkflow(seismicWorkflow, attachmentAnalyses);
}

function attachmentAnalysisText(
  attachment: AttachmentInfo,
  analysis: Record<string, unknown>,
  locale: AppLocale,
): string {
  const header = locale === 'zh'
    ? `[附件解析: ${attachment.originalName}]`
    : `[Attachment analysis: ${attachment.originalName}]`;
  return `${header}\n${JSON.stringify(compactAttachmentAnalysis(analysis), null, 2)}`;
}

function attachmentVisionSummaryText(
  attachment: AttachmentInfo,
  summary: string,
  locale: AppLocale,
): string {
  const header = locale === 'zh'
    ? `[附件视觉摘要: ${attachment.originalName}]`
    : `[Attachment vision summary: ${attachment.originalName}]`;
  return `${header}\n${summary}`;
}

function attachmentVisionUnavailableText(
  attachment: AttachmentInfo,
  locale: AppLocale,
): string {
  const header = locale === 'zh'
    ? `[附件视觉摘要不可用: ${attachment.originalName}]`
    : `[Attachment vision summary unavailable: ${attachment.originalName}]`;
  const body = locale === 'zh'
    ? '未配置独立 vision 模型或 vision 模型调用失败。不要假设图片中的尺寸、荷载或边界条件；如需继续分析，请向用户追问缺失信息。'
    : 'No independent vision model is configured or the vision call failed. Do not assume dimensions, loads, or boundary conditions from this image; ask the user for missing information before analysis.';
  return `${header}\n${body}`;
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : String(content);
}

async function summarizeImageAttachment(
  attachment: AttachmentInfo,
  dataUri: string,
  userMessage: string,
  locale: AppLocale,
  signal?: AbortSignal,
): Promise<string | null> {
  const model = createVisionChatModel(0, { disableStreaming: true });
  if (!model) return null;

  const prompt = locale === 'zh'
    ? [
      '你是结构工程图像理解助手。只根据图片中可见的文字、标注和几何关系提取信息，不要臆测不可见内容。',
      '请用简洁中文输出：结构类型、可见几何尺寸、可见荷载、支座/边界、材料/截面文字、仍不确定的信息。',
      `附件名：${attachment.originalName}`,
      `用户任务：${userMessage}`,
    ].join('\n')
    : [
      'You are a structural engineering image understanding assistant. Extract only information visible in the image text, labels, and geometry; do not invent hidden details.',
      'Return a concise summary covering: structural type, visible dimensions, visible loads, supports/boundaries, material/section labels, and remaining uncertainties.',
      `Attachment name: ${attachment.originalName}`,
      `User task: ${userMessage}`,
    ].join('\n');

  try {
    const result = await model.invoke([
      new HumanMessage({
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      }),
    ], signal ? { signal } : undefined);
    const text = messageContentText(result.content).trim();
    return text || null;
  } catch (error) {
    logger.warn({
      attachment: attachment.originalName,
      error: error instanceof Error ? error.message : String(error),
    }, 'attachment vision summary failed');
    return null;
  }
}

function toInitialHumanMessage(content: string | HumanMessageContentBlock[]): HumanMessage {
  return Array.isArray(content)
    ? new HumanMessage({ content })
    : new HumanMessage(content);
}

function shouldKeepFullAttachmentAnalysis(
  attachment: AttachmentInfo,
  analysis: Record<string, unknown>,
): boolean {
  const name = `${attachment.originalName} ${attachment.relPath}`.toLowerCase();
  const type = typeof analysis.type === 'string' ? analysis.type : '';
  return (type === 'csv' || type === 'text')
    && (
      name.endsWith('.csv')
      || name.endsWith('.tsv')
      || name.endsWith('.at2')
      || name.endsWith('.txt')
    );
}

export async function buildInitialHumanMessagePayload(
  message: string,
  attachments: AttachmentInfo[] | undefined,
  locale: AppLocale,
  workspaceRoot: string,
  options: InitialHumanMessageOptions = {},
): Promise<InitialHumanMessagePayload> {
  const attachmentBlock = buildAttachmentBlock(attachments, locale);
  if (!attachments || attachments.length === 0) {
    return { content: message, canonicalMessage: message, attachmentAnalyses: [] };
  }

  const contentParts = [message + attachmentBlock];
  const canonicalParts = [message + attachmentBlock];
  const attachmentAnalyses: AttachmentAnalysis[] = [];

  for (const attachment of attachments) {
    const analysis = await analyzeUploadedFile(
      attachment.relPath,
      workspaceRoot,
      undefined,
      { includeImageData: true },
    );
    const runtimeAnalysis = shouldKeepFullAttachmentAnalysis(attachment, analysis)
      ? await analyzeUploadedFile(
        attachment.relPath,
        workspaceRoot,
        undefined,
        { mode: 'full' },
      )
      : analysis;
    attachmentAnalyses.push({ attachment, analysis: runtimeAnalysis });
    const analysisText = attachmentAnalysisText(attachment, analysis, locale);
    canonicalParts.push(analysisText);
    contentParts.push(analysisText);
    if (analysis.type === 'image') {
      if (options.summarizeImages) {
        const summary = typeof analysis.base64DataUri === 'string'
          ? await summarizeImageAttachment(
            attachment,
            analysis.base64DataUri,
            message,
            locale,
            options.signal,
          )
          : null;
        if (summary) {
          const summaryText = attachmentVisionSummaryText(attachment, summary, locale);
          canonicalParts.push(summaryText);
          contentParts.push(summaryText);
        } else {
          const unavailableText = attachmentVisionUnavailableText(attachment, locale);
          canonicalParts.push(unavailableText);
          contentParts.push(unavailableText);
        }
      }
      continue;
    }
  }

  return {
    content: contentParts.join('\n\n'),
    canonicalMessage: canonicalParts.join('\n\n'),
    attachmentAnalyses,
  };
}

export async function buildInitialHumanMessageContent(
  message: string,
  attachments: AttachmentInfo[] | undefined,
  locale: AppLocale,
  workspaceRoot: string,
): Promise<string | HumanMessageContentBlock[]> {
  return (await buildInitialHumanMessagePayload(message, attachments, locale, workspaceRoot)).content;
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let singleton: LangGraphAgentService | undefined;

export function getAgentService(): LangGraphAgentService {
  if (!singleton) {
    singleton = new LangGraphAgentService(new AgentSkillRuntime({
      workspaceSkillRoot: getWorkspaceSkillRoot(),
    }));
  }
  return singleton;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class LangGraphAgentService {
  readonly skillRuntime: AgentSkillRuntime;
  private readonly checkpointer: FileCheckpointer;
  private readonly workspaceRoot: string;

  // Execution clients (created once, injected via config.configurable)
  private readonly engineClient: ReturnType<typeof createLocalAnalysisEngineClient>;
  private readonly codeCheckClient: ReturnType<typeof createLocalCodeCheckClient>;
  private readonly structureProtocolClient: ReturnType<typeof createLocalStructureProtocolClient>;

  // Cached graph — built once, reused across requests
  private graphPromise: Promise<Awaited<ReturnType<typeof buildAgentGraph>>> | undefined;

  constructor(skillRuntime: AgentSkillRuntime) {
    this.skillRuntime = skillRuntime;
    this.checkpointer = new FileCheckpointer(getCheckpointerDataDir());
    this.workspaceRoot = getWorkspaceRoot();

    // Create execution clients once (lifetime of the process)
    this.engineClient = createLocalAnalysisEngineClient();
    this.codeCheckClient = createLocalCodeCheckClient();
    this.structureProtocolClient = createLocalStructureProtocolClient();
  }

  // ---------------------------------------------------------------------------
  // Configurable builder (DI container for tools/nodes)
  // ---------------------------------------------------------------------------

  private buildConfigurable(input?: LangGraphRunInput, traceId?: string, conversationId?: string): AgentConfigurable & { _logger?: unknown } {
    const childLogger = (traceId && conversationId)
      ? createAgentLogger(traceId, conversationId)
      : undefined;
    return {
      skillRuntime: this.skillRuntime,
      engineClient: this.engineClient,
      codeCheckClient: this.codeCheckClient,
      structureProtocolClient: this.structureProtocolClient,
      workspaceRoot: this.workspaceRoot,
      enabledToolIds: input?.context?.enabledToolIds,
      disabledToolIds: input?.context?.disabledToolIds,
      allowShell: getAllowShellTools(),
      maxToolCallsPerTurn: config.agentMaxToolCallsPerTurn,
      _logger: childLogger,
    };
  }

  private buildGraphRuntimeConfig(input?: LangGraphRunInput, traceId?: string, conversationId?: string) {
    return {
      recursionLimit: getLangGraphRecursionLimit(config.agentMaxToolCallsPerTurn),
      signal: input?.signal,
      configurable: {
        thread_id: conversationId,
        ...this.buildConfigurable(input, traceId, conversationId),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Conversation auto-creation
  // ---------------------------------------------------------------------------

  private async ensureConversationRecord(
    conversationId: string | undefined,
    message: string,
  ): Promise<string> {
    if (conversationId) return conversationId;

    const conversation = await prisma.conversation.create({
      data: {
        title: message.slice(0, 50),
        type: 'general',
      },
    });
    return conversation.id;
  }

  // ---------------------------------------------------------------------------
  // Graph construction (cached)
  // ---------------------------------------------------------------------------

  /** Get or build the compiled graph. Thread-safe for concurrent first calls. */
  private async getGraph(): Promise<Awaited<ReturnType<typeof buildAgentGraph>>> {
    if (!this.graphPromise) {
      this.graphPromise = (async () => {
        const skillManifests = await this.skillRuntime.listSkillManifests();
        return await buildAgentGraph({
          skillRuntime: this.skillRuntime,
          skillManifests,
          checkpointer: this.checkpointer,
        });
      })();
    }
    return this.graphPromise;
  }

  /** Force rebuild the graph (e.g. after skill install/uninstall). */
  resetGraph(): void {
    this.graphPromise = undefined;
  }

  // ---------------------------------------------------------------------------
  // Streaming entry point
  // ---------------------------------------------------------------------------

  async *runStream(input: LangGraphRunInput): AsyncGenerator<AgentStreamChunk> {
    const locale = input.context?.locale || 'zh';
    const conversationId = await this.ensureConversationRecord(
      input.conversationId, input.message,
    );
    const skillIds = input.context?.skillIds || [];
    const traceId = input.traceId || randomUUID();
    const startedAt = new Date().toISOString();
    const reqStart = Date.now();

    const graph = await this.getGraph();

    const config = this.buildGraphRuntimeConfig(input, traceId, conversationId);

    const reqLogger = createAgentLogger(traceId, conversationId);
    reqLogger.info({ message: input.message.slice(0, 100) }, 'LangGraph agent stream started');

    const initialPayload = await buildInitialHumanMessagePayload(
      input.message,
      input.context?.attachments,
      locale,
      this.workspaceRoot,
      { summarizeImages: true, signal: input.signal },
    );
    const contextSeismicWorkflow = extractContextSeismicWorkflow(input.context, initialPayload.attachmentAnalyses);
    const stream = await graph.stream(
      {
        messages: [toInitialHumanMessage(initialPayload.content)],
        locale,
        workspaceRoot: this.workspaceRoot,
        selectedSkillIds: skillIds,
        lastUserMessage: initialPayload.canonicalMessage,
        contextSeismicWorkflow,
        policy: {
          analysisType: input.context?.analysisType,
          designCode: input.context?.designCode,
        },
      },
      { ...config, streamMode: ['messages', 'updates', 'custom'] as any },
    );

    const ctx: StreamContext = { conversationId, traceId, startedAt };
    try {
      yield* streamGraphToChunks(stream, ['messages', 'updates', 'custom'], ctx);
    } finally {
      reqLogger.info({ durationMs: Date.now() - reqStart, mode: 'stream' }, 'LangGraph agent stream completed');
    }
  }

  // ---------------------------------------------------------------------------
  // Resume after interrupt
  // ---------------------------------------------------------------------------

  async *resumeStream(
    conversationId: string,
    resumeValue: string,
  ): AsyncGenerator<AgentStreamChunk> {
    const traceId = randomUUID();
    const startedAt = new Date().toISOString();
    const reqStart = Date.now();

    const graph = await this.getGraph();

    const config = this.buildGraphRuntimeConfig(undefined, traceId, conversationId);

    const reqLogger = createAgentLogger(traceId, conversationId);
    reqLogger.info('LangGraph agent resume started');

    const stream = await graph.stream(
      new Command({ resume: resumeValue }),
      { ...config, streamMode: ['messages', 'updates', 'custom'] as any },
    );

    const ctx: StreamContext = { conversationId, traceId, startedAt };
    try {
      yield* streamGraphToChunks(stream, ['messages', 'updates', 'custom'], ctx);
    } finally {
      reqLogger.info({ durationMs: Date.now() - reqStart, mode: 'resume' }, 'LangGraph agent resume completed');
    }
  }

  // ---------------------------------------------------------------------------
  // Synchronous entry point
  // ---------------------------------------------------------------------------

  async run(input: LangGraphRunInput): Promise<LangGraphRunResult> {
    const locale = input.context?.locale || 'zh';
    const conversationId = await this.ensureConversationRecord(
      input.conversationId, input.message,
    );
    const skillIds = input.context?.skillIds || [];
    const traceId = input.traceId || randomUUID();
    const startedAt = new Date().toISOString();
    const reqStart = Date.now();

    const graph = await this.getGraph();

    const config = this.buildGraphRuntimeConfig(input, traceId, conversationId);

    const reqLogger = createAgentLogger(traceId, conversationId);
    reqLogger.info({ message: input.message.slice(0, 100) }, 'LangGraph agent run started');

    const initialPayload = await buildInitialHumanMessagePayload(
      input.message,
      input.context?.attachments,
      locale,
      this.workspaceRoot,
      { summarizeImages: true, signal: input.signal },
    );
    const contextSeismicWorkflow = extractContextSeismicWorkflow(input.context, initialPayload.attachmentAnalyses);
    const result = await graph.invoke(
      {
        messages: [toInitialHumanMessage(initialPayload.content)],
        locale,
        workspaceRoot: this.workspaceRoot,
        selectedSkillIds: skillIds,
        lastUserMessage: initialPayload.canonicalMessage,
        contextSeismicWorkflow,
        policy: {
          analysisType: input.context?.analysisType,
          designCode: input.context?.designCode,
        },
      },
      config,
    );

    const runResult = this.extractResult(result, conversationId, traceId, startedAt);
    reqLogger.info({ durationMs: Date.now() - reqStart, mode: runResult.mode, toolCallCount: runResult.toolCalls.length, success: runResult.success }, 'LangGraph agent run completed');
    return runResult;
  }

  /**
   * Run the agent and return the full final AgentState (not just the summary).
   * Used by benchmark tooling that needs access to model, analysisResult, report etc.
   */
  async runFull(input: LangGraphRunInput): Promise<AgentState> {
    const locale = input.context?.locale || 'zh';
    const conversationId = input.conversationId || `bench-${randomUUID()}`;
    const traceId = input.traceId || randomUUID();
    const reqStart = Date.now();
    const graph = await this.getGraph();
    const config = this.buildGraphRuntimeConfig(input, traceId, conversationId);

    const reqLogger = createAgentLogger(traceId, conversationId);
    reqLogger.info({ message: input.message.slice(0, 100) }, 'LangGraph agent runFull started');

    const initialPayload = await buildInitialHumanMessagePayload(
      input.message,
      input.context?.attachments,
      locale,
      this.workspaceRoot,
      { summarizeImages: true, signal: input.signal },
    );
    const contextSeismicWorkflow = extractContextSeismicWorkflow(input.context, initialPayload.attachmentAnalyses);
    const result = await graph.invoke(
      {
        messages: [toInitialHumanMessage(initialPayload.content)],
        locale,
        workspaceRoot: this.workspaceRoot,
        selectedSkillIds: input.context?.skillIds || [],
        lastUserMessage: initialPayload.canonicalMessage,
        contextSeismicWorkflow,
        policy: {
          analysisType: input.context?.analysisType,
          designCode: input.context?.designCode,
        },
      },
      config,
    ) as AgentState;

    reqLogger.info({ durationMs: Date.now() - reqStart, mode: 'full' }, 'LangGraph agent runFull completed');
    return result;
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  async getConversationSessionSnapshot(
    conversationId: string,
    _locale: AppLocale,
  ): Promise<{ snapshot: Record<string, unknown>; state?: AgentState } | undefined> {
    try {
      const graph = await this.getGraph();
      const config = { configurable: { thread_id: conversationId } };
      const stateSnapshot = await graph.getState(config);
      const state = stateSnapshot.values as AgentState;

      return {
        snapshot: {
          draft: state.draftState || null,
          interaction: {
            state: 'ready',
            stage: 'model',
            turnId: conversationId,
          },
          model: undefined,
          updatedAt: new Date().toISOString(),
        },
        state,
      };
    } catch (error) {
      logger.debug({ conversationId, error }, 'Failed to load session snapshot');
      return undefined;
    }
  }

  async clearConversationSession(conversationId: string): Promise<void> {
    await this.checkpointer.deleteThread(conversationId);
  }

  async listSkills(): Promise<{ skills: SkillManifest[] }> {
    const manifests = await this.skillRuntime.listSkillManifests();
    return { skills: manifests };
  }

  /**
   * Get the agent protocol (tool metadata) as a static method.
   * Keeps name/description route compatibility while sourcing from registry.
   */
  static getProtocol(): {
    tools: Array<{
      name: string;
      description: string;
      displayName: { zh: string; en: string };
      localizedDescription: { zh: string; en: string };
      category: string;
      risk: string;
      defaultEnabled: boolean;
    }>;
  } {
    return {
      tools: listAgentToolDefinitions().map((definition) => ({
        name: definition.id,
        description: definition.description.en,
        displayName: definition.displayName,
        localizedDescription: definition.description,
        category: definition.category,
        risk: definition.risk,
        defaultEnabled: definition.defaultEnabled,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Result extraction
  // ---------------------------------------------------------------------------

  private extractResult(
    finalState: AgentState,
    conversationId: string,
    traceId: string,
    startedAt: string,
  ): LangGraphRunResult {
    const messages = Array.isArray(finalState.messages) ? finalState.messages : [];
    const lastMessage = messages[messages.length - 1];

    let response = '';
    if (lastMessage && 'content' in lastMessage) {
      response = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }

    const toolCalls: unknown[] = [];
    for (const msg of messages) {
      if (msg && typeof msg === 'object' && 'tool_calls' in msg) {
        const tc = (msg as any).tool_calls;
        if (Array.isArray(tc)) toolCalls.push(...tc);
      }
    }

    return {
      conversationId,
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      success: true,
      response,
      mode: toolCalls.length > 0 ? 'execution' : 'conversation',
      toolCalls,
      draftState: finalState.draftState ?? undefined,
    };
  }
}
