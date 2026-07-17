/**
 * LangGraph tool definitions for the StructureClaw ReAct agent.
 *
 * Tools read dependencies from config.configurable (AgentConfigurable)
 * and state from the graph state via config.configurable.agentState.
 *
 * Artifact-writing tools (build_model, run_analysis, etc.) return
 * Command({ update }) objects to write directly into graph state channels,
 * eliminating the need for an extract_artifacts intermediary node.
 *
 * Custom streaming events are emitted via config.writer for real-time
 * tool status updates to the frontend.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Command, interrupt } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { logger } from '../utils/logger.js';
import { getLogger, logToolCall } from '../utils/agent-logger.js';
import { createChatModel } from '../utils/llm.js';
import type { AgentState } from './state.js';
import type { AgentConfigurable } from './configurable.js';
import type { AgentSkillPlugin, DraftState, InteractionQuestion, StructuralTypeMatch } from '../agent-runtime/types.js';
import { isFreshGenericStructuralRoute } from '../agent-runtime/plugin-helpers.js';
import { runPkpmCalcbook } from '../agent-skills/report-export/calculation-book/pkpm-calcbook/runner.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the AgentConfigurable from the LangGraph run config. */
function getConfigurable(config: LangGraphRunnableConfig): AgentConfigurable & { agentState?: AgentState } {
  return config.configurable as AgentConfigurable & { agentState?: AgentState };
}

/** Get the tool call ID from the LangChain config. */
function getToolCallId(config: LangGraphRunnableConfig): string {
  const id = (config as any).toolCall?.id;
  if (!id) throw new Error('Tool call ID not available in config');
  return id;
}

function messageRole(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  const getType = record._getType;
  if (typeof getType === 'function') {
    return String(getType.call(message));
  }
  if (typeof record.role === 'string') return record.role;
  if (typeof record.type === 'string') return record.type;
  if (Array.isArray(record.id) && record.id.some((part) => String(part).includes('HumanMessage'))) {
    return 'human';
  }
  return null;
}

function messageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
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
      .join('');
  }
  return content == null ? '' : String(content);
}

function latestHumanMessageText(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messageRole(messages[i]);
    if (role === 'human' || role === 'user') {
      return messageText(messages[i]).trim();
    }
  }
  return '';
}

const ATTACHMENT_DETAIL_MARKERS = [
  '[Attachment analysis:',
  '[附件解析:',
  '[Attachment vision summary:',
  '[附件视觉摘要:',
  '[Attachment vision summary unavailable:',
  '[附件视觉摘要不可用:',
];

function findAttachmentDetailsStart(message: string): number {
  return ATTACHMENT_DETAIL_MARKERS.reduce((best, marker) => {
    const index = message.indexOf(marker);
    if (index === -1) return best;
    return best === -1 ? index : Math.min(best, index);
  }, -1);
}

function hasAttachmentDetails(message: string | undefined): boolean {
  const text = message || '';
  return findAttachmentDetailsStart(text) !== -1;
}

function canonicalAttachmentDetailsOnly(message: string): string {
  const start = findAttachmentDetailsStart(message);
  return start === -1 ? '' : message.slice(start).trim();
}

function withCanonicalAttachmentDetails(message: string, canonicalUserMessage: string | undefined): string {
  const canonical = canonicalUserMessage?.trim();
  if (!canonical || !hasAttachmentDetails(canonical) || hasAttachmentDetails(message)) {
    return message;
  }
  const attachmentDetails = canonicalAttachmentDetailsOnly(canonical);
  return attachmentDetails ? `${message}\n\n${attachmentDetails}` : message;
}

export function resolveToolInputMessage(
  inputMessage: string | undefined,
  lastUserMessage: string | undefined,
  messages?: unknown[],
): string {
  const explicitMessage = inputMessage?.trim();
  if (explicitMessage) {
    return withCanonicalAttachmentDetails(explicitMessage, lastUserMessage);
  }
  const canonicalUserMessage = lastUserMessage?.trim();
  if (canonicalUserMessage) {
    return canonicalUserMessage;
  }
  const latestHumanMessage = latestHumanMessageText(messages);
  if (latestHumanMessage) {
    return latestHumanMessage;
  }
  return '';
}

const ANALYSIS_SKILL_ENGINE_IDS: Record<string, string> = {
  'opensees-static': 'builtin-opensees',
  'opensees-dynamic': 'builtin-opensees',
  'opensees-seismic': 'builtin-opensees',
  'opensees-nonlinear': 'builtin-opensees',
  'pkpm-static': 'builtin-pkpm',
  'yjk-static': 'builtin-yjk',
};

const ANALYSIS_SKILL_TYPES: Record<string, 'static' | 'dynamic' | 'seismic' | 'nonlinear'> = {
  'opensees-static': 'static',
  'opensees-dynamic': 'dynamic',
  'opensees-seismic': 'seismic',
  'opensees-nonlinear': 'nonlinear',
  'pkpm-static': 'static',
  'yjk-static': 'static',
};

const ANALYSIS_SKILL_LABELS: Record<string, string> = {
  'opensees-static': 'OpenSees static analysis',
  'opensees-dynamic': 'OpenSees dynamic analysis',
  'opensees-seismic': 'OpenSees seismic analysis',
  'opensees-nonlinear': 'OpenSees nonlinear analysis',
  'pkpm-static': 'PKPM/SATWE static analysis',
  'yjk-static': 'YJK static analysis',
};

const CHINA_SEISMIC_BASELINE_SKILL_IDS = [
  'generic',
  'frame',
  'concrete-frame',
  'opensees-seismic',
  'code-check-gb50011',
  'validation-structure-model',
  'report-export-builtin',
];

const ANALYSIS_SKILL_ID_VALUES = [
  'opensees-static',
  'opensees-dynamic',
  'opensees-seismic',
  'opensees-nonlinear',
  'pkpm-static',
  'yjk-static',
] as const;

export function detectRequestedAnalysisSkillId(_message: string | undefined): string | undefined {
  // Provider requests must arrive as structured analysisSkillId, not text matches.
  return undefined;
}

function selectedAnalysisSkillIds(
  selectedSkillIds?: string[],
  analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear',
): string[] {
  return Array.isArray(selectedSkillIds)
    ? selectedSkillIds.filter((skillId) =>
      ANALYSIS_SKILL_ENGINE_IDS[skillId]
      && (!analysisType || ANALYSIS_SKILL_TYPES[skillId] === analysisType))
    : [];
}

export function resolveRequestedAnalysisSkillId(
  _message: string | undefined,
  selectedSkillIds?: string[],
  analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear',
  requestedAnalysisSkillId?: string,
): string | undefined {
  const analysisSkillIds = selectedAnalysisSkillIds(selectedSkillIds, analysisType);
  if (requestedAnalysisSkillId) {
    if (
      analysisSkillIds.includes(requestedAnalysisSkillId)
      && (!analysisType || ANALYSIS_SKILL_TYPES[requestedAnalysisSkillId] === analysisType)
    ) {
      return requestedAnalysisSkillId;
    }
    return undefined;
  }

  return analysisSkillIds[0];
}

export function resolveRequestedAnalysisEngineId(
  message: string | undefined,
  selectedSkillIds?: string[],
  analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear',
  requestedAnalysisSkillId?: string,
): string | undefined {
  const skillId = resolveRequestedAnalysisSkillId(message, selectedSkillIds, analysisType, requestedAnalysisSkillId);
  return skillId ? ANALYSIS_SKILL_ENGINE_IDS[skillId] : undefined;
}

export function resolveUnselectedRequestedAnalysisSkillId(
  _message: string | undefined,
  selectedSkillIds?: string[],
  analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear',
  requestedAnalysisSkillId?: string,
): string | undefined {
  if (!requestedAnalysisSkillId || !ANALYSIS_SKILL_ENGINE_IDS[requestedAnalysisSkillId]) {
    return undefined;
  }
  if (analysisType && ANALYSIS_SKILL_TYPES[requestedAnalysisSkillId] !== analysisType) {
    return requestedAnalysisSkillId;
  }
  const selected = selectedAnalysisSkillIds(selectedSkillIds, analysisType);
  const requestedEngineId = ANALYSIS_SKILL_ENGINE_IDS[requestedAnalysisSkillId];
  const providerSatisfied = selected.some((skillId) =>
    skillId === requestedAnalysisSkillId || ANALYSIS_SKILL_ENGINE_IDS[skillId] === requestedEngineId);
  return providerSatisfied
    ? undefined
    : requestedAnalysisSkillId;
}

function buildAnalysisProviderNotSelectedPayload(skillId: string) {
  const label = ANALYSIS_SKILL_LABELS[skillId] ?? skillId;
  return {
    success: false,
    error_code: 'ANALYSIS_PROVIDER_NOT_SELECTED',
    requestedAnalysisSkillId: skillId,
    message: `The requested analysis provider (${label}) is not enabled in the current skill selection.`,
    messageZh: `当前会话未勾选请求的分析技能（${label}），不会改用其他分析引擎代跑。`,
  };
}

function parseSkillIdsJson(value: string): { ok: true; value: string[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'skillIdsJson must be a JSON array of strings.' };
    }
    return {
      ok: true,
      value: parsed
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim()),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function isChinaSeismicSessionConfig(args: {
  analysisType?: string;
  designCode?: string;
  skillIds: string[];
}): boolean {
  const designCode = (args.designCode || '').toUpperCase();
  return args.analysisType === 'seismic'
    || designCode.includes('50011')
    || designCode.includes('55002')
    || args.skillIds.includes('opensees-seismic')
    || args.skillIds.includes('code-check-gb50011');
}

function completeChinaSeismicSkillIds(skillIds: string[]): string[] {
  const requested = new Set(skillIds);
  return uniqueStrings([
    ...CHINA_SEISMIC_BASELINE_SKILL_IDS,
    ...skillIds.filter((skillId) => !CHINA_SEISMIC_BASELINE_SKILL_IDS.includes(skillId)),
  ]).filter((skillId) => requested.has(skillId) || CHINA_SEISMIC_BASELINE_SKILL_IDS.includes(skillId));
}

/**
 * Create a Command that updates graph state channels AND adds a ToolMessage.
 * This is the recommended LangGraph pattern for tools that produce artifacts.
 */
function toolResult(
  toolCallId: string,
  toolName: string,
  content: string,
  stateUpdate?: Partial<AgentState>,
): Command {
  return new Command({
    update: {
      ...(stateUpdate || {}),
      messages: [new ToolMessage({
        content,
        tool_call_id: toolCallId,
        name: toolName,
      })],
    },
  });
}

type ParsedJsonObjectInput =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

type ToolAnalysisType = 'static' | 'dynamic' | 'seismic' | 'nonlinear';

function normalizeAnalysisType(value: unknown): ToolAnalysisType | undefined {
  return value === 'static' || value === 'dynamic' || value === 'seismic' || value === 'nonlinear'
    ? value
    : undefined;
}

function analysisResultRecord(analysis: unknown): Record<string, unknown> {
  return isRecord(analysis) ? analysis : {};
}

function inferAnalysisTypeFromResult(analysis: unknown): ToolAnalysisType | undefined {
  const record = analysisResultRecord(analysis);
  const meta = isRecord(record.meta) ? record.meta : {};
  const data = isRecord(record.data) ? record.data : {};
  const direct = normalizeAnalysisType(meta.analysisType)
    ?? normalizeAnalysisType(meta.analysis_type)
    ?? normalizeAnalysisType(record.analysisType)
    ?? normalizeAnalysisType(record.analysis_type)
    ?? normalizeAnalysisType(record.type)
    ?? normalizeAnalysisType(data.analysisType)
    ?? normalizeAnalysisType(data.analysis_type)
    ?? normalizeAnalysisType(data.type);
  if (direct) {
    return direct;
  }
  const analysisMode = typeof data.analysisMode === 'string' ? data.analysisMode.toLowerCase() : '';
  const workflowInputMode = typeof data.workflowInputMode === 'string' ? data.workflowInputMode.toLowerCase() : '';
  if (analysisMode.includes('seismic') || workflowInputMode.includes('seismic')) {
    return 'seismic';
  }
  return undefined;
}

function inferEffectiveAnalysisType(
  inputAnalysisType: unknown,
  state: AgentState | undefined,
): ToolAnalysisType {
  return inferAnalysisTypeFromResult(state?.analysisResult)
    ?? normalizeAnalysisType(state?.policy?.analysisType)
    ?? normalizeAnalysisType(inputAnalysisType)
    ?? 'static';
}

function parseJsonObjectInput(value: string | undefined, fieldName: string): ParsedJsonObjectInput | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: `${fieldName} must be a JSON object.` };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${fieldName} is not valid JSON: ${message}` };
  }
}

function hasStructuredSeismicWorkflow(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

function hasSemanticSeismicWorkflowInput(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  if (!hasStructuredSeismicWorkflow(value)) {
    return false;
  }
  const semanticTopLevelKeys = Object.keys(value).filter((key) =>
    !['groundMotionSet', 'groundMotions', 'groundMotionRecords', 'timeHistoryRecords'].includes(key));
  if (semanticTopLevelKeys.length > 0) {
    return true;
  }
  const groundMotionSet = isRecord(value.groundMotionSet) ? value.groundMotionSet : undefined;
  if (!groundMotionSet) {
    return false;
  }
  return Object.keys(groundMotionSet).some((key) =>
    !['source', 'uploadedAttachments', 'records'].includes(key));
}

function mergeStructuredRecords(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (!base) {
    return override ? { ...override } : undefined;
  }
  if (!override) {
    return { ...base };
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key];
    result[key] = isRecord(baseValue) && isRecord(value)
      ? mergeStructuredRecords(baseValue, value)
      : value;
  }
  return result;
}

function isUploadedGroundMotionContext(value: Record<string, unknown> | undefined): boolean {
  const groundMotionSet = isRecord(value?.groundMotionSet) ? value.groundMotionSet : undefined;
  if (!groundMotionSet) {
    return false;
  }
  const source = typeof groundMotionSet.source === 'string'
    ? groundMotionSet.source.trim().toLowerCase()
    : '';
  return source === 'uploaded'
    || Array.isArray(groundMotionSet.uploadedAttachments);
}

function shouldMergeUploadedGroundMotionContext(
  base: Record<string, unknown> | undefined,
  context: Record<string, unknown> | undefined,
): boolean {
  if (!isUploadedGroundMotionContext(context)) {
    return true;
  }
  const baseGroundMotionSet = isRecord(base?.groundMotionSet) ? base.groundMotionSet : undefined;
  const source = typeof baseGroundMotionSet?.source === 'string'
    ? baseGroundMotionSet.source.trim().toLowerCase()
    : '';
  return !source || source === 'uploaded';
}

function mergeSeismicWorkflowInputs(
  semanticWorkflow: Record<string, unknown> | undefined,
  contextWorkflow: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!semanticWorkflow) {
    return contextWorkflow ? { ...contextWorkflow } : undefined;
  }
  if (!contextWorkflow || !shouldMergeUploadedGroundMotionContext(semanticWorkflow, contextWorkflow)) {
    return { ...semanticWorkflow };
  }
  return mergeStructuredRecords(semanticWorkflow, contextWorkflow);
}

function isPositiveFiniteNumber(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isPositiveIntegerLike(value: unknown): boolean {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function hasGroundMotionSource(record: Record<string, unknown>): boolean {
  if (
    Array.isArray(record['values'])
    || Array.isArray(record['accelerations'])
    || Array.isArray(record['accel'])
    || Array.isArray(record['rows'])
  ) {
    return true;
  }
  for (const key of ['content', 'text', 'csv', 'at2', 'data'] as const) {
    if (typeof record[key] === 'string' && record[key].trim().length > 0) {
      return true;
    }
  }
  for (const key of ['fileAnalysis', 'analysis', 'parsedFile', 'file'] as const) {
    const nested = record[key];
    if (isRecord(nested) && hasGroundMotionSource(nested)) {
      return true;
    }
  }
  return false;
}

function validateGroundMotionRecords(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${fieldPath} must be an array when provided.`);
    return;
  }
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${fieldPath}[${index}] must be an object.`);
      return;
    }
    if (!hasGroundMotionSource(item)) {
      errors.push(`${fieldPath}[${index}] must include values, rows, text/content, or parsed file data.`);
    }
  });
}

function localCatalogRecordIds(records: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(records)) {
    return ids;
  }
  records.forEach((item) => {
    if (!isRecord(item)) {
      return;
    }
    const id = item['id'] ?? item['catalogId'] ?? item['name'];
    if (typeof id === 'string' && id.trim()) {
      ids.add(id.trim());
    }
  });
  return ids;
}

function validateEarthquakeLevelValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const text = String(value).trim().toLowerCase();
  const allowed = new Set([
    'frequent',
    'minor',
    'small',
    'frequent_earthquake',
    'service',
    '多遇',
    '小震',
    '多遇地震',
    'fortification',
    'design',
    'moderate',
    'basic',
    'design_earthquake',
    '设防',
    '中震',
    '设防地震',
    'rare',
    'major',
    'large',
    'maximum',
    'rare_earthquake',
    'no_collapse',
    '罕遇',
    '大震',
    '罕遇地震',
  ]);
  if (!allowed.has(text)) {
    errors.push(`${fieldPath} must be frequent, fortification, or rare when provided.`);
  }
}

function validateIntegerRangeValue(value: unknown, fieldPath: string, min: number, max: number, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    errors.push(`${fieldPath} must be an integer from ${min} to ${max} when provided.`);
  }
}

function validatePositiveNumberValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isPositiveFiniteNumber(value)) {
    errors.push(`${fieldPath} must be a positive number when provided.`);
  }
}

function validatePositiveFractionValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 1) {
    errors.push(`${fieldPath} must be greater than 0 and less than 1 when provided.`);
  }
}

function validateDesignGroupValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const text = String(value).trim().toLowerCase();
  if (!['1', '2', '3', '一', '二', '三', '第一组', '第二组', '第三组', 'group1', 'group2', 'group3', 'group 1', 'group 2', 'group 3'].includes(text)) {
    errors.push(`${fieldPath} must be one of 1, 2, or 3 when provided.`);
  }
}

function validateSiteCategoryValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const text = String(value).trim().toUpperCase().replace('类', '');
  if (!['0', '1', '2', '3', '4', 'I0', 'I1', 'I', 'II', 'III', 'IV'].includes(text)) {
    errors.push(`${fieldPath} must be one of I0, I1, I, II, III, or IV when provided.`);
  }
}

function validateFortificationCategoryValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const text = String(value).trim().toLowerCase();
  const allowed = new Set([
    'special',
    'key',
    'standard',
    'moderate',
    '甲',
    '甲类',
    '特殊设防类',
    '乙',
    '乙类',
    '重点设防类',
    '丙',
    '丙类',
    '标准设防类',
    '丁',
    '丁类',
    '适度设防类',
  ]);
  if (!allowed.has(text)) {
    errors.push(`${fieldPath} must be special, key, standard, or moderate when provided.`);
  }
}

function validateRegularityValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const text = String(value).trim().toLowerCase();
  const allowed = new Set([
    'regular',
    'regularity_regular',
    '规则',
    'irregular',
    'general_irregular',
    '不规则',
    '一般不规则',
    'particularly_irregular',
    'special_irregular',
    'severe',
    'serious',
    '特别不规则',
    '严重不规则',
    'unknown',
  ]);
  if (!allowed.has(text)) {
    errors.push(`${fieldPath} must be regular, irregular, or particularly_irregular when provided.`);
  }
}

function validateSeismicGradeValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 4) {
    return;
  }
  const text = String(value).trim().toLowerCase();
  const allowed = new Set([
    'i',
    'ii',
    'iii',
    'iv',
    'grade1',
    'grade2',
    'grade3',
    'grade4',
    'grade 1',
    'grade 2',
    'grade 3',
    'grade 4',
    'first',
    'second',
    'third',
    'fourth',
    '一级',
    '二级',
    '三级',
    '四级',
    '一',
    '二',
    '三',
    '四',
  ]);
  if (!allowed.has(text)) {
    errors.push(`${fieldPath} must be an integer from 1 to 4 when provided.`);
  }
}

function validateStoryCountValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isPositiveIntegerLike(value)) {
    errors.push(`${fieldPath} must be a positive integer when provided.`);
  }
}

function validateStructuredBooleanValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'string' && ['true', 'false', 'yes', 'no', '1', '0'].includes(value.trim().toLowerCase())) {
    return;
  }
  errors.push(`${fieldPath} must be a boolean when provided.`);
}

function validateSiteSeismicFields(siteSeismic: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  validateIntegerRangeValue(siteSeismic['intensity'], `${fieldPath}.intensity`, 6, 9, errors);
  validatePositiveNumberValue(siteSeismic['accelerationG'], `${fieldPath}.accelerationG`, errors);
  validatePositiveNumberValue(siteSeismic['acceleration_g'], `${fieldPath}.acceleration_g`, errors);
  validatePositiveNumberValue(siteSeismic['basicAccelerationG'], `${fieldPath}.basicAccelerationG`, errors);
  validatePositiveNumberValue(siteSeismic['designBasicAccelerationG'], `${fieldPath}.designBasicAccelerationG`, errors);
  validateDesignGroupValue(siteSeismic['designGroup'], `${fieldPath}.designGroup`, errors);
  validateDesignGroupValue(siteSeismic['design_group'], `${fieldPath}.design_group`, errors);
  validateSiteCategoryValue(siteSeismic['siteCategory'], `${fieldPath}.siteCategory`, errors);
  validateSiteCategoryValue(siteSeismic['site_category'], `${fieldPath}.site_category`, errors);
  validateSiteCategoryValue(siteSeismic['siteClass'], `${fieldPath}.siteClass`, errors);
  validatePositiveFractionValue(siteSeismic['dampingRatio'], `${fieldPath}.dampingRatio`, errors);
  validatePositiveFractionValue(siteSeismic['damping_ratio'], `${fieldPath}.damping_ratio`, errors);
  const zonationRecord = isRecord(siteSeismic['zonationRecord']) ? siteSeismic['zonationRecord'] : undefined;
  if (zonationRecord) {
    validateZonationTableValue(zonationRecord, `${fieldPath}.zonationRecord`, errors);
  }
}

function validateSeismicSafetyEvaluationValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${fieldPath} must be an object when provided.`);
    return;
  }
  validateStructuredBooleanValue(value['approved'], `${fieldPath}.approved`, errors);
  validateIntegerRangeValue(value['intensity'], `${fieldPath}.intensity`, 6, 9, errors);
  validatePositiveNumberValue(value['accelerationG'], `${fieldPath}.accelerationG`, errors);
  validatePositiveNumberValue(value['acceleration_g'], `${fieldPath}.acceleration_g`, errors);
  validatePositiveNumberValue(value['basicAccelerationG'], `${fieldPath}.basicAccelerationG`, errors);
  validatePositiveNumberValue(value['designBasicAccelerationG'], `${fieldPath}.designBasicAccelerationG`, errors);
  validateDesignGroupValue(value['designGroup'], `${fieldPath}.designGroup`, errors);
  validateDesignGroupValue(value['design_group'], `${fieldPath}.design_group`, errors);
  validatePositiveNumberValue(value['characteristicPeriod'], `${fieldPath}.characteristicPeriod`, errors);
  validatePositiveNumberValue(value['characteristic_period'], `${fieldPath}.characteristic_period`, errors);
  validatePositiveNumberValue(value['Tg'], `${fieldPath}.Tg`, errors);
  validatePositiveNumberValue(value['rareCharacteristicPeriod'], `${fieldPath}.rareCharacteristicPeriod`, errors);
  validatePositiveNumberValue(value['rare_characteristic_period'], `${fieldPath}.rare_characteristic_period`, errors);
  validatePositiveNumberValue(value['rareTg'], `${fieldPath}.rareTg`, errors);
  validatePositiveNumberValue(value['maxInfluenceCoefficient'], `${fieldPath}.maxInfluenceCoefficient`, errors);
  validatePositiveNumberValue(value['alphaMax'], `${fieldPath}.alphaMax`, errors);
}

const STRUCTURED_REVIEW_TRACE_KEYS = [
  'overLimitReview',
  'specialReview',
  'specialSeismicReview',
  'overLimitSpecialReview',
] as const;

const STRUCTURED_REVIEW_BOOLEAN_KEYS = [
  'reviewRequired',
  'required',
  'requiresReview',
  'overLimitReviewRequired',
  'requiresOverLimitReview',
  'specialReviewRequired',
  'requiresSpecialReview',
  'specialSeismicReviewRequired',
  'approved',
  'reviewApproved',
  'approvalProvided',
  'reviewCompleted',
  'completed',
  'provided',
  'expertReviewProvided',
  'expertReviewCompleted',
] as const;

const STRUCTURED_REVIEW_STRING_KEYS = [
  'status',
  'reviewStatus',
  'approvalStatus',
  'conclusion',
  'reviewConclusion',
  'approvalConclusion',
  'reviewType',
  'type',
  'approvalId',
  'reviewId',
  'reportId',
  'authority',
  'reviewAuthority',
  'date',
  'reviewDate',
  'approvalDate',
] as const;

const STRUCTURED_REVIEW_REASON_KEYS = [
  'reasons',
  'reviewReasons',
  'overLimitReasons',
  'specialReviewReasons',
] as const;

function validateOptionalNonEmptyStringValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${fieldPath} must be a non-empty string when provided.`);
  }
}

function validateOptionalStringOrStringArrayValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    if (!value.trim()) {
      errors.push(`${fieldPath} must be a string or an array of non-empty strings when provided.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== 'string' || !item.trim())) {
      errors.push(`${fieldPath} must contain only non-empty strings when provided.`);
    }
    return;
  }
  errors.push(`${fieldPath} must be a string or an array of non-empty strings when provided.`);
}

function validateStructuredReviewTraceFields(review: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  for (const key of STRUCTURED_REVIEW_BOOLEAN_KEYS) {
    validateStructuredBooleanValue(review[key], `${fieldPath}.${key}`, errors);
  }
  for (const key of STRUCTURED_REVIEW_STRING_KEYS) {
    validateOptionalNonEmptyStringValue(review[key], `${fieldPath}.${key}`, errors);
  }
  for (const key of STRUCTURED_REVIEW_REASON_KEYS) {
    validateOptionalStringOrStringArrayValue(review[key], `${fieldPath}.${key}`, errors);
  }
}

function validateStructuredReviewTraceValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${fieldPath} must be an object when provided.`);
    return;
  }
  validateStructuredReviewTraceFields(value, fieldPath, errors);
}

function validateStructuredReviewTraceFieldsInRecord(record: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  for (const key of STRUCTURED_REVIEW_TRACE_KEYS) {
    const reviewFieldPath = fieldPath ? `${fieldPath}.${key}` : key;
    validateStructuredReviewTraceValue(record[key], reviewFieldPath, errors);
  }
}

function validateRegularityAssessmentReviewFields(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${fieldPath} must be an object when provided.`);
    return;
  }
  for (const key of STRUCTURED_REVIEW_BOOLEAN_KEYS) {
    validateStructuredBooleanValue(value[key], `${fieldPath}.${key}`, errors);
  }
  for (const key of STRUCTURED_REVIEW_REASON_KEYS) {
    validateOptionalStringOrStringArrayValue(value[key], `${fieldPath}.${key}`, errors);
  }
}

function zonationRecordHasParameter(record: Record<string, unknown>): boolean {
  return Boolean(
    record['accelerationG'] !== undefined
    || record['acceleration_g'] !== undefined
    || record['basicAccelerationG'] !== undefined
    || record['designBasicAccelerationG'] !== undefined
    || record['pgaG'] !== undefined
    || record['peakAccelerationG'] !== undefined
    || record['amaxG'] !== undefined
    || record['intensity'] !== undefined
    || record['seismicIntensity'] !== undefined
    || record['fortificationIntensity'] !== undefined
    || record['designGroup'] !== undefined
    || record['design_group'] !== undefined
    || record['earthquakeGroup'] !== undefined
    || record['characteristicPeriod'] !== undefined
    || record['characteristic_period'] !== undefined
    || record['Tg'] !== undefined
    || record['tg'] !== undefined
    || record['maxInfluenceCoefficient'] !== undefined
    || record['max_influence_coefficient'] !== undefined
    || record['alphaMax'] !== undefined
  );
}

function validateZonationRecordFields(record: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  if (!zonationRecordHasParameter(record)) {
    errors.push(`${fieldPath} must include acceleration, intensity, design group, characteristic period, or alphaMax.`);
  }
  validateIntegerRangeValue(record['intensity'], `${fieldPath}.intensity`, 6, 9, errors);
  validateIntegerRangeValue(record['seismicIntensity'], `${fieldPath}.seismicIntensity`, 6, 9, errors);
  validateIntegerRangeValue(record['fortificationIntensity'], `${fieldPath}.fortificationIntensity`, 6, 9, errors);
  validatePositiveNumberValue(record['accelerationG'], `${fieldPath}.accelerationG`, errors);
  validatePositiveNumberValue(record['acceleration_g'], `${fieldPath}.acceleration_g`, errors);
  validatePositiveNumberValue(record['basicAccelerationG'], `${fieldPath}.basicAccelerationG`, errors);
  validatePositiveNumberValue(record['designBasicAccelerationG'], `${fieldPath}.designBasicAccelerationG`, errors);
  validatePositiveNumberValue(record['pgaG'], `${fieldPath}.pgaG`, errors);
  validatePositiveNumberValue(record['peakAccelerationG'], `${fieldPath}.peakAccelerationG`, errors);
  validatePositiveNumberValue(record['amaxG'], `${fieldPath}.amaxG`, errors);
  validateDesignGroupValue(record['designGroup'], `${fieldPath}.designGroup`, errors);
  validateDesignGroupValue(record['design_group'], `${fieldPath}.design_group`, errors);
  validateDesignGroupValue(record['earthquakeGroup'], `${fieldPath}.earthquakeGroup`, errors);
  validatePositiveNumberValue(record['characteristicPeriod'], `${fieldPath}.characteristicPeriod`, errors);
  validatePositiveNumberValue(record['characteristic_period'], `${fieldPath}.characteristic_period`, errors);
  validatePositiveNumberValue(record['Tg'], `${fieldPath}.Tg`, errors);
  validatePositiveNumberValue(record['tg'], `${fieldPath}.tg`, errors);
  validatePositiveNumberValue(record['maxInfluenceCoefficient'], `${fieldPath}.maxInfluenceCoefficient`, errors);
  validatePositiveNumberValue(record['max_influence_coefficient'], `${fieldPath}.max_influence_coefficient`, errors);
  validatePositiveNumberValue(record['alphaMax'], `${fieldPath}.alphaMax`, errors);
}

function validateZonationRecords(records: unknown, fieldPath: string, errors: string[]): void {
  if (!Array.isArray(records)) {
    errors.push(`${fieldPath} must be an array when provided.`);
    return;
  }
  if (records.length === 0) {
    errors.push(`${fieldPath} must contain at least one record.`);
    return;
  }
  records.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${fieldPath}[${index}] must be an object.`);
      return;
    }
    validateZonationRecordFields(item, `${fieldPath}[${index}]`, errors);
  });
}

function isZonationParameterKey(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return false;
  }
  const key = String(value).trim();
  return [
    'accelerationG',
    'acceleration_g',
    'basicAccelerationG',
    'designBasicAccelerationG',
    'pgaG',
    'peakAccelerationG',
    'amaxG',
    'intensity',
    'seismicIntensity',
    'fortificationIntensity',
    'designGroup',
    'design_group',
    'earthquakeGroup',
    'characteristicPeriod',
    'characteristic_period',
    'Tg',
    'tg',
    'maxInfluenceCoefficient',
    'max_influence_coefficient',
    'alphaMax',
  ].includes(key);
}

function validateZonationTableValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    validateZonationRecords(value, fieldPath, errors);
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${fieldPath} must be an object or an array of records when provided.`);
    return;
  }
  if (value['records'] !== undefined) {
    validateZonationRecords(value['records'], `${fieldPath}.records`, errors);
    return;
  }
  if (value['headers'] !== undefined || value['rows'] !== undefined) {
    if (!Array.isArray(value['headers']) || !Array.isArray(value['rows'])) {
      errors.push(`${fieldPath}.headers and ${fieldPath}.rows must both be arrays when provided.`);
      return;
    }
    if ((value['headers'] as unknown[]).length === 0 || (value['rows'] as unknown[]).length === 0) {
      errors.push(`${fieldPath}.headers and ${fieldPath}.rows must not be empty when provided.`);
    }
    if (!(value['headers'] as unknown[]).some((header) => isZonationParameterKey(header))) {
      errors.push(`${fieldPath}.headers must include acceleration, intensity, design group, characteristic period, or alphaMax.`);
    }
    if (!(value['rows'] as unknown[]).every((row) => Array.isArray(row))) {
      errors.push(`${fieldPath}.rows must contain row arrays.`);
    }
    return;
  }
  validateZonationRecordFields(value, fieldPath, errors);
}

function validateDesignBasisFields(designBasis: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  validateIntegerRangeValue(designBasis['intensity'], `${fieldPath}.intensity`, 6, 9, errors);
  validatePositiveNumberValue(designBasis['accelerationG'], `${fieldPath}.accelerationG`, errors);
  validatePositiveNumberValue(designBasis['acceleration_g'], `${fieldPath}.acceleration_g`, errors);
  validatePositiveNumberValue(designBasis['designBasicAccelerationG'], `${fieldPath}.designBasicAccelerationG`, errors);
  validateDesignGroupValue(designBasis['designGroup'], `${fieldPath}.designGroup`, errors);
  validateDesignGroupValue(designBasis['design_group'], `${fieldPath}.design_group`, errors);
  validateSiteCategoryValue(designBasis['siteCategory'], `${fieldPath}.siteCategory`, errors);
  validateSiteCategoryValue(designBasis['site_category'], `${fieldPath}.site_category`, errors);
  validatePositiveFractionValue(designBasis['dampingRatio'], `${fieldPath}.dampingRatio`, errors);
  validatePositiveFractionValue(designBasis['damping_ratio'], `${fieldPath}.damping_ratio`, errors);
  validateFortificationCategoryValue(designBasis['fortificationCategory'], `${fieldPath}.fortificationCategory`, errors);
  validateSeismicGradeValue(designBasis['seismicGrade'], `${fieldPath}.seismicGrade`, errors);
  validateSeismicGradeValue(designBasis['antiSeismicGrade'], `${fieldPath}.antiSeismicGrade`, errors);
  validatePositiveNumberValue(designBasis['heightM'], `${fieldPath}.heightM`, errors);
  validatePositiveNumberValue(designBasis['totalHeightM'], `${fieldPath}.totalHeightM`, errors);
  validateStoryCountValue(designBasis['storyCount'], `${fieldPath}.storyCount`, errors);
  validateSeismicSafetyEvaluationValue(designBasis['seismicSafetyEvaluation'], `${fieldPath}.seismicSafetyEvaluation`, errors);
  validateSeismicSafetyEvaluationValue(designBasis['safetyEvaluation'], `${fieldPath}.safetyEvaluation`, errors);
  validateZonationTableValue(designBasis['groundMotionZonation'], `${fieldPath}.groundMotionZonation`, errors);
  validateZonationTableValue(designBasis['zonation'], `${fieldPath}.zonation`, errors);
  validateZonationTableValue(designBasis['zonationRecords'], `${fieldPath}.zonationRecords`, errors);
  const siteSeismic = isRecord(designBasis['siteSeismic']) ? designBasis['siteSeismic'] : undefined;
  if (siteSeismic) {
    validateSiteSeismicFields(siteSeismic, `${fieldPath}.siteSeismic`, errors);
  }
  validateStructuredReviewTraceFieldsInRecord(designBasis, fieldPath, errors);
}

function validatePerformanceObjectiveValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    if (!value.trim()) {
      errors.push(`${fieldPath} must be a non-empty string or an object when provided.`);
    }
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${fieldPath} must be a string or an object when provided.`);
    return;
  }
  validatePositiveFractionValue(value['acceptanceDriftRatio'], `${fieldPath}.acceptanceDriftRatio`, errors);
  validatePositiveFractionValue(value['limitDriftRatio'], `${fieldPath}.limitDriftRatio`, errors);
  validatePositiveNumberValue(value['targetDisplacement'], `${fieldPath}.targetDisplacement`, errors);
  validatePositiveNumberValue(value['performanceTargetDisplacement'], `${fieldPath}.performanceTargetDisplacement`, errors);
}

function validateDesignRequirementFields(requirements: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  validateIntegerRangeValue(requirements['intensity'], `${fieldPath}.intensity`, 6, 9, errors);
  validatePositiveNumberValue(requirements['accelerationG'], `${fieldPath}.accelerationG`, errors);
  validatePositiveNumberValue(requirements['designBasicAccelerationG'], `${fieldPath}.designBasicAccelerationG`, errors);
  validateFortificationCategoryValue(requirements['fortificationCategory'], `${fieldPath}.fortificationCategory`, errors);
  validateSeismicGradeValue(requirements['seismicGrade'], `${fieldPath}.seismicGrade`, errors);
  validateSeismicGradeValue(requirements['antiSeismicGrade'], `${fieldPath}.antiSeismicGrade`, errors);
  validateRegularityValue(requirements['irregularity'], `${fieldPath}.irregularity`, errors);
  validateRegularityValue(requirements['regularity'], `${fieldPath}.regularity`, errors);
  validatePositiveFractionValue(requirements['acceptanceDriftRatio'], `${fieldPath}.acceptanceDriftRatio`, errors);
  validatePerformanceObjectiveValue(requirements['performanceObjective'], `${fieldPath}.performanceObjective`, errors);
  validateSeismicSafetyEvaluationValue(requirements['seismicSafetyEvaluation'], `${fieldPath}.seismicSafetyEvaluation`, errors);
  validateSeismicSafetyEvaluationValue(requirements['safetyEvaluation'], `${fieldPath}.safetyEvaluation`, errors);
  for (const key of [
    'supplementaryTimeHistory',
    'requiresTimeHistory',
    'requiresVerticalSeismic',
    'requiresElasticPlasticDeformation',
    'requiresPerformanceBasedCheck',
    'hasLargeSpan',
    'hasLongCantilever',
    'hasIsolation',
    'hasEnergyDissipation',
    'hasEnergyDissipationSystem',
    'hasDampingDevice',
  ] as const) {
    validateStructuredBooleanValue(requirements[key], `${fieldPath}.${key}`, errors);
  }
}

function validateStructureProfileFields(structure: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  validatePositiveNumberValue(structure['heightM'], `${fieldPath}.heightM`, errors);
  validatePositiveNumberValue(structure['totalHeightM'], `${fieldPath}.totalHeightM`, errors);
  validateStoryCountValue(structure['storyCount'], `${fieldPath}.storyCount`, errors);
  validateSeismicGradeValue(structure['seismicGrade'], `${fieldPath}.seismicGrade`, errors);
  validateRegularityValue(structure['regularity'], `${fieldPath}.regularity`, errors);
  validateRegularityValue(structure['irregularity'], `${fieldPath}.irregularity`, errors);
  for (const key of ['hasLargeSpan', 'hasLongCantilever', 'hasIsolation', 'hasEnergyDissipation', 'hasEnergyDissipationSystem', 'hasDampingDevice', 'isHighRise', 'highRise'] as const) {
    validateStructuredBooleanValue(structure[key], `${fieldPath}.${key}`, errors);
  }
}

function validatePushoverFields(pushover: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  validatePositiveNumberValue(pushover['targetDisplacement'], `${fieldPath}.targetDisplacement`, errors);
  validatePositiveNumberValue(pushover['performanceTargetDisplacement'], `${fieldPath}.performanceTargetDisplacement`, errors);
  validatePositiveNumberValue(pushover['performancePointDisplacement'], `${fieldPath}.performancePointDisplacement`, errors);
  validatePositiveFractionValue(pushover['acceptanceDriftRatio'], `${fieldPath}.acceptanceDriftRatio`, errors);
  validatePositiveIntegerValue(pushover['steps'], `${fieldPath}.steps`, errors);
  validatePerformanceObjectiveValue(pushover['performanceObjective'], `${fieldPath}.performanceObjective`, errors);
}

function validateElasticPlasticTimeHistoryFields(section: Record<string, unknown>, fieldPath: string, errors: string[]): void {
  validatePositiveFractionValue(section['acceptanceDriftRatio'], `${fieldPath}.acceptanceDriftRatio`, errors);
  validatePerformanceObjectiveValue(section['performanceObjective'], `${fieldPath}.performanceObjective`, errors);
}

function validatePositiveIntegerValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isPositiveIntegerLike(value)) {
    errors.push(`${fieldPath} must be a positive integer when provided.`);
  }
}

function validateNonlinearModelValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${fieldPath} must be an object when provided.`);
    return;
  }
  const hinges = value['memberPlasticHinges'];
  if (hinges !== undefined) {
    if (!Array.isArray(hinges)) {
      errors.push(`${fieldPath}.memberPlasticHinges must be an array when provided.`);
    } else if (hinges.some((item) => !isRecord(item))) {
      errors.push(`${fieldPath}.memberPlasticHinges must contain only objects when provided.`);
    }
  }
}

function validateOptionalRecordValue(value: unknown, fieldPath: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${fieldPath} must be an object when provided.`);
  }
}

function validateSeismicWorkflowInput(workflow: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const method = workflow['methodPreference'] ?? workflow['method'] ?? workflow['analysisMethod'];
  if (method !== undefined) {
    const text = String(method).trim().toLowerCase();
    if (!['auto', 'response_spectrum', 'time_history', 'pushover', 'elastic_plastic_time_history'].includes(text)) {
      errors.push('methodPreference must be one of auto, response_spectrum, time_history, pushover, or elastic_plastic_time_history.');
    }
  }

  const directions = workflow['directions'];
  if (directions !== undefined) {
    if (!Array.isArray(directions) || directions.some((direction) => !['x', 'y'].includes(String(direction).trim().toLowerCase()))) {
      errors.push('directions must be an array containing only x and/or y.');
    }
  }

  const responseSpectrum = isRecord(workflow['responseSpectrum']) ? workflow['responseSpectrum'] : undefined;
  const modalCombination = responseSpectrum?.['modalCombination'];
  if (modalCombination !== undefined) {
    const text = String(modalCombination).trim().toLowerCase();
    if (!['cqc', 'srss'].includes(text)) {
      errors.push('responseSpectrum.modalCombination must be cqc or srss.');
    }
  }

  validateEarthquakeLevelValue(workflow['earthquakeLevel'], 'earthquakeLevel', errors);
  validatePositiveFractionValue(workflow['dampingRatio'], 'dampingRatio', errors);
  validateFortificationCategoryValue(workflow['fortificationCategory'], 'fortificationCategory', errors);
  validateSeismicGradeValue(workflow['seismicGrade'], 'seismicGrade', errors);
  validatePositiveNumberValue(workflow['heightM'], 'heightM', errors);
  validateStoryCountValue(workflow['storyCount'], 'storyCount', errors);
  validateRegularityValue(workflow['irregularity'], 'irregularity', errors);
  validateRegularityValue(workflow['regularity'], 'regularity', errors);
  validateZonationTableValue(workflow['groundMotionZonation'], 'groundMotionZonation', errors);
  validateZonationTableValue(workflow['zonation'], 'zonation', errors);
  validateZonationTableValue(workflow['zonationRecords'], 'zonationRecords', errors);
  validatePerformanceObjectiveValue(workflow['performanceObjective'], 'performanceObjective', errors);
  validateSeismicSafetyEvaluationValue(workflow['seismicSafetyEvaluation'], 'seismicSafetyEvaluation', errors);
  validateSeismicSafetyEvaluationValue(workflow['safetyEvaluation'], 'safetyEvaluation', errors);
  validateNonlinearModelValue(workflow['nonlinearModel'], 'nonlinearModel', errors);
  validateOptionalRecordValue(workflow['isolationSystem'], 'isolationSystem', errors);
  validateOptionalRecordValue(workflow['baseIsolationSystem'], 'baseIsolationSystem', errors);
  validateOptionalRecordValue(workflow['energyDissipationSystem'], 'energyDissipationSystem', errors);
  validateOptionalRecordValue(workflow['dampingSystem'], 'dampingSystem', errors);
  validateOptionalRecordValue(workflow['dampingDevices'], 'dampingDevices', errors);
  validateStructuredReviewTraceFieldsInRecord(workflow, '', errors);
  validateRegularityAssessmentReviewFields(workflow['regularityAssessment'], 'regularityAssessment', errors);
  for (const key of [
    'requiresTimeHistory',
    'requiresVerticalSeismic',
    'requiresElasticPlasticDeformation',
    'requiresPerformanceBasedCheck',
    'hasLargeSpan',
    'hasLongCantilever',
    'hasIsolation',
    'hasEnergyDissipation',
    'hasEnergyDissipationSystem',
    'hasDampingDevice',
    'isHighRise',
    'highRise',
  ] as const) {
    validateStructuredBooleanValue(workflow[key], key, errors);
  }
  const workflowSiteSeismic = isRecord(workflow['siteSeismic']) ? workflow['siteSeismic'] : undefined;
  if (workflowSiteSeismic) {
    validateSiteSeismicFields(workflowSiteSeismic, 'siteSeismic', errors);
  }
  const analysisControl = isRecord(workflow['analysisControl']) ? workflow['analysisControl'] : undefined;
  if (analysisControl) {
    validatePositiveFractionValue(analysisControl['dampingRatio'], 'analysisControl.dampingRatio', errors);
    validatePositiveFractionValue(analysisControl['damping_ratio'], 'analysisControl.damping_ratio', errors);
    validatePositiveNumberValue(analysisControl['targetDisplacement'], 'analysisControl.targetDisplacement', errors);
    validatePositiveNumberValue(analysisControl['performanceTargetDisplacement'], 'analysisControl.performanceTargetDisplacement', errors);
    validatePerformanceObjectiveValue(analysisControl['performanceObjective'], 'analysisControl.performanceObjective', errors);
  }
  const pushover = isRecord(workflow['pushover']) ? workflow['pushover'] : undefined;
  if (pushover) {
    validatePushoverFields(pushover, 'pushover', errors);
  } else if (workflow['pushover'] !== undefined) {
    errors.push('pushover must be an object when provided.');
  }
  const elasticPlasticTimeHistory = isRecord(workflow['elasticPlasticTimeHistory']) ? workflow['elasticPlasticTimeHistory'] : undefined;
  if (elasticPlasticTimeHistory) {
    validateElasticPlasticTimeHistoryFields(elasticPlasticTimeHistory, 'elasticPlasticTimeHistory', errors);
  } else if (workflow['elasticPlasticTimeHistory'] !== undefined) {
    errors.push('elasticPlasticTimeHistory must be an object when provided.');
  }
  const nonlinearTimeHistory = isRecord(workflow['nonlinearTimeHistory']) ? workflow['nonlinearTimeHistory'] : undefined;
  if (nonlinearTimeHistory) {
    validateElasticPlasticTimeHistoryFields(nonlinearTimeHistory, 'nonlinearTimeHistory', errors);
  } else if (workflow['nonlinearTimeHistory'] !== undefined) {
    errors.push('nonlinearTimeHistory must be an object when provided.');
  }
  const designBasis = isRecord(workflow['designBasis']) ? workflow['designBasis'] : undefined;
  if (designBasis) {
    validateEarthquakeLevelValue(designBasis['earthquakeLevel'], 'designBasis.earthquakeLevel', errors);
    validateDesignBasisFields(designBasis, 'designBasis', errors);
    const siteSeismic = isRecord(designBasis['siteSeismic']) ? designBasis['siteSeismic'] : undefined;
    if (siteSeismic) {
      validateEarthquakeLevelValue(siteSeismic['earthquakeLevel'], 'designBasis.siteSeismic.earthquakeLevel', errors);
    }
  }
  const designRequirements = isRecord(workflow['designRequirements']) ? workflow['designRequirements'] : undefined;
  if (designRequirements) {
    validateEarthquakeLevelValue(designRequirements['earthquakeLevel'], 'designRequirements.earthquakeLevel', errors);
    validateEarthquakeLevelValue(designRequirements['targetEarthquakeLevel'], 'designRequirements.targetEarthquakeLevel', errors);
    validateDesignRequirementFields(designRequirements, 'designRequirements', errors);
  }
  const methodDecision = isRecord(workflow['methodDecision']) ? workflow['methodDecision'] : undefined;
  if (methodDecision) {
    validateStructuredReviewTraceFieldsInRecord(methodDecision, 'methodDecision', errors);
  } else if (workflow['methodDecision'] !== undefined) {
    errors.push('methodDecision must be an object when provided.');
  }
  const structure = isRecord(workflow['structure']) ? workflow['structure'] : undefined;
  if (structure) {
    validateStructureProfileFields(structure, 'structure', errors);
  }
  const structureProfile = isRecord(workflow['structureProfile']) ? workflow['structureProfile'] : undefined;
  if (structureProfile) {
    validateStructureProfileFields(structureProfile, 'structureProfile', errors);
  }
  const groundMotionRequirement = isRecord(workflow['groundMotionRequirement']) ? workflow['groundMotionRequirement'] : undefined;
  if (groundMotionRequirement) {
    validateEarthquakeLevelValue(groundMotionRequirement['targetEarthquakeLevel'], 'groundMotionRequirement.targetEarthquakeLevel', errors);
  }

  const groundMotionSet = isRecord(workflow['groundMotionSet']) ? workflow['groundMotionSet'] : undefined;
  if (groundMotionSet) {
    validateGroundMotionRecords(groundMotionSet['records'], 'groundMotionSet.records', errors);
    for (const key of ['requiredCount', 'expectedCount'] as const) {
      if (groundMotionSet[key] !== undefined && !isPositiveIntegerLike(groundMotionSet[key])) {
        errors.push(`groundMotionSet.${key} must be a positive integer when provided.`);
      }
    }
    const catalogIds = groundMotionSet['catalogIds'];
    if (
      catalogIds !== undefined
      && (!Array.isArray(catalogIds) || catalogIds.some((item) => typeof item !== 'string' || !item.trim()))
    ) {
      errors.push('groundMotionSet.catalogIds must be an array of non-empty strings when provided.');
    }
    const localCatalog = isRecord(groundMotionSet['localCatalog']) ? groundMotionSet['localCatalog'] : undefined;
    if (localCatalog) {
      validateGroundMotionRecords(localCatalog['records'], 'groundMotionSet.localCatalog.records', errors);
    }
    const source = typeof groundMotionSet['source'] === 'string' ? groundMotionSet['source'].trim().toLowerCase() : '';
    const hasDirectRecords = Array.isArray(groundMotionSet['records']) && groundMotionSet['records'].length > 0;
    if (source === 'uploaded' && !hasDirectRecords) {
      errors.push('groundMotionSet.records is required when source is uploaded; analyze uploaded files and preserve CSV rows or AT2/TXT content in records before running analysis.');
    }
    const hasLocalCatalogRecords = Array.isArray(localCatalog?.['records']);
    if (
      ['local_catalog', 'licensed_catalog', 'project_catalog'].includes(source)
      && !hasLocalCatalogRecords
      && groundMotionSet['records'] === undefined
    ) {
      errors.push('groundMotionSet.localCatalog.records or groundMotionSet.records is required when source is local_catalog, licensed_catalog, or project_catalog.');
    }
    if (catalogIds !== undefined && localCatalog) {
      const ids = localCatalogRecordIds(localCatalog['records']);
      const missingIds = Array.isArray(catalogIds)
        ? catalogIds.filter((item) => typeof item === 'string' && item.trim() && !ids.has(item.trim()))
        : [];
      if (missingIds.length > 0) {
        errors.push(`groundMotionSet.catalogIds not found in localCatalog.records: ${missingIds.join(', ')}.`);
      }
    }
    const scaleFactorLimit = groundMotionSet['scaleFactorLimit'];
    if (scaleFactorLimit !== undefined && !isPositiveFiniteNumber(scaleFactorLimit)) {
      errors.push('groundMotionSet.scaleFactorLimit must be a positive number when provided.');
    }
  }

  return errors;
}

function buildDraftProgress(
  locale: 'zh' | 'en',
  criticalMissing: string[],
): { canProceed: boolean; nextAction: 'ask_user_clarification' | 'build_model'; reason?: string; instruction: string } {
  if (criticalMissing.length === 0) {
    return {
      canProceed: true,
      nextAction: 'build_model',
      instruction: locale === 'zh'
        ? 'criticalMissing 为空。下一步调用 build_model；不要因为可默认或非关键的 draftIssues 先追问。'
        : 'criticalMissing is empty. Call build_model next; do not ask for clarification first just because defaultable or non-critical draftIssues are present.',
    };
  }
  const missingText = criticalMissing.join(', ');
  return {
    canProceed: false,
    nextAction: 'ask_user_clarification',
    instruction: locale === 'zh'
      ? '存在关键缺失字段。下一步调用 ask_user_clarification；不要调用 build_model。'
      : 'Critical fields are missing. Call ask_user_clarification next; do not call build_model.',
    reason: locale === 'zh'
      ? `草稿仍缺少关键参数：${missingText}。需要继续向用户澄清，不能直接构建模型或写入 memory。`
      : `The draft is still missing critical parameters: ${missingText}. Continue by asking the user for clarification; do not build the model or store draft values in memory.`,
  };
}

function buildPluginUnavailableProgress(
  locale: 'zh' | 'en',
): { canProceed: false; nextAction: 'ask_user_clarification'; reason: string } {
  return {
    canProceed: false,
    nextAction: 'ask_user_clarification',
    reason: locale === 'zh'
      ? '已保留上一版有效草稿，但无法解析对应结构类型插件，不能可靠计算缺失字段或继续建模。请先确认结构类型或恢复可用 skillScope。'
      : 'The previous valid draft was preserved, but its structure-type plugin could not be resolved. Missing fields cannot be computed reliably, so ask the user to confirm the structural type or restore the available skill scope before building a model.',
  };
}

function buildClarificationQuestions(
  plugin: AgentSkillPlugin | null | undefined,
  criticalMissing: string[],
  optionalMissing: string[],
  state: DraftState,
  locale: 'zh' | 'en',
): InteractionQuestion[] {
  if (criticalMissing.length === 0) return [];
  return plugin?.handler.buildQuestions?.(criticalMissing, optionalMissing, state, locale) ?? [];
}

function hasStableDraftType(state: DraftState | null | undefined): state is DraftState {
  return !!state?.inferredType && state.inferredType !== 'unknown';
}

export function shouldPreserveExistingDraftState(
  existingState: DraftState | null | undefined,
  structuralTypeMatch: StructuralTypeMatch,
  message?: string,
): existingState is DraftState {
  if (!hasStableDraftType(existingState)) {
    return false;
  }
  if (structuralTypeMatch.routingSource === 'llm-suggested') {
    return false;
  }
  if (structuralTypeMatch.key === 'unknown' && structuralTypeMatch.mappedType === 'unknown') {
    return true;
  }
  return isRetryFeedbackMessage(message) && isConflictingStructuralType(existingState, structuralTypeMatch);
}

function isRetryFeedbackMessage(message: string | undefined): boolean {
  const text = message?.trim();
  if (!text) return false;
  return /^上次尝试失败[:：]/.test(text) || /^Previous attempt failed[:：]/i.test(text);
}

export function resolveRetryTaskMessage(message: string | undefined): string {
  const text = message?.trim();
  if (!text || !isRetryFeedbackMessage(text)) {
    return text || '';
  }
  const split = text.split(/\r?\n\s*\r?\n/);
  if (split.length < 2) {
    return text;
  }
  const taskMessage = split.slice(1).join('\n\n').trim();
  return taskMessage || text;
}

function isConflictingStructuralType(
  existingState: DraftState,
  structuralTypeMatch: StructuralTypeMatch,
): boolean {
  if (structuralTypeMatch.mappedType !== existingState.inferredType) {
    return false;
  }
  const existingKey = existingState.structuralTypeKey ?? existingState.inferredType;
  const nextKey = structuralTypeMatch.key;
  if (!nextKey || nextKey === 'unknown') return false;
  return nextKey !== existingKey;
}

function buildPreservedStructuralTypeMatch(
  state: DraftState,
  plugin: AgentSkillPlugin | null | undefined,
): StructuralTypeMatch {
  return {
    key: state.structuralTypeKey ?? state.inferredType,
    mappedType: state.inferredType,
    skillId: state.skillId ?? plugin?.id,
    supportLevel: state.supportLevel ?? 'supported',
    supportNote: state.supportNote,
    routingSource: 'current-state',
  };
}

export function buildPreservedDraftExtractionResult(args: {
  existingState: DraftState;
  structuralTypeMatch: StructuralTypeMatch;
  plugin?: AgentSkillPlugin | null;
  locale: 'zh' | 'en';
}): {
  responseJson: Record<string, unknown>;
  stateUpdate: Partial<AgentState>;
} {
  const plugin = args.plugin ?? null;
  const mergedState = plugin
    ? plugin.handler.mergeState(args.existingState, {})
    : args.existingState;
  const nextState = { ...mergedState, routingSource: 'current-state' as const, updatedAt: Date.now() };
  const missing = plugin
    ? plugin.handler.computeMissing(nextState, 'execution')
    : { critical: ['skillPlugin'], optional: [] };
  const progress = plugin
    ? buildDraftProgress(args.locale, missing.critical)
    : buildPluginUnavailableProgress(args.locale);
  const clarificationQuestions = plugin
    ? buildClarificationQuestions(plugin, missing.critical, missing.optional, nextState, args.locale)
    : [];
  const preservedMatch = buildPreservedStructuralTypeMatch(nextState, plugin);
  const preservationWarning = args.locale === 'zh'
    ? '本轮描述未能稳定识别为新的结构类型，已保留上一版有效草稿，避免将状态覆盖为 unknown/generic。'
    : 'The current message was not recognized as a stable new structural type, so the previous valid draft was preserved instead of being overwritten as unknown/generic.';

  return {
    responseJson: {
      nextState,
      criticalMissing: missing.critical,
      optionalMissing: missing.optional,
      clarificationQuestions,
      structuralTypeMatch: preservedMatch,
      rejectedStructuralTypeMatch: args.structuralTypeMatch,
      skillId: preservedMatch.skillId,
      routingSource: preservedMatch.routingSource,
      extractionMode: 'preserved',
      preservationWarning,
      ...progress,
    },
    stateUpdate: {
      draftState: nextState,
      structuralTypeKey: preservedMatch.key,
    },
  };
}

const ANALYSIS_MESSAGE_LIMIT = 6000;
type TextCompaction = 'middle' | 'tail';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeCheckSkillIdFromResult(codeCheck: unknown): string | undefined {
  if (!isRecord(codeCheck)) return undefined;
  const meta = isRecord(codeCheck.meta) ? codeCheck.meta : {};
  const skillId = typeof meta.codeCheckSkillId === 'string' ? meta.codeCheckSkillId.trim() : '';
  return skillId || undefined;
}

function analysisTraceIdFromResult(analysis: unknown): string | undefined {
  if (!isRecord(analysis)) return undefined;
  const meta = isRecord(analysis.meta) ? analysis.meta : {};
  const traceId = typeof meta.traceId === 'string' ? meta.traceId.trim() : '';
  return traceId || undefined;
}

function codeCheckAnalysisTraceIdFromResult(codeCheck: unknown): string | undefined {
  if (!isRecord(codeCheck)) return undefined;
  const meta = isRecord(codeCheck.meta) ? codeCheck.meta : {};
  const traceId = typeof meta.analysisTraceId === 'string' ? meta.analysisTraceId.trim() : '';
  return traceId || undefined;
}

function codeCheckPayloadFromResult(codeCheck: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(codeCheck.data) ? codeCheck.data : {};
  return Object.keys(data).length > 0 ? data : codeCheck;
}

function hasGlobalSeismicCodeCheckDetail(codeCheck: Record<string, unknown>): boolean {
  const payload = codeCheckPayloadFromResult(codeCheck);
  const details = Array.isArray(payload.details) ? payload.details.filter(isRecord) : [];
  return details.some((detail) => {
    const elementId = typeof detail.elementId === 'string' ? detail.elementId.trim() : '';
    const elementType = typeof detail.elementType === 'string' ? detail.elementType.trim() : '';
    return elementId === '__global_seismic__' || elementType === 'global-seismic';
  });
}

function hasValidChinaSeismicCodeCheck(codeCheck: unknown, analysis: unknown): boolean {
  if (!isRecord(codeCheck) || codeCheck.skipped === true) return false;
  const analysisTraceId = analysisTraceIdFromResult(analysis);
  const codeCheckAnalysisTraceId = codeCheckAnalysisTraceIdFromResult(codeCheck);
  if (analysisTraceId && codeCheckAnalysisTraceId !== analysisTraceId) {
    return false;
  }
  return codeCheckSkillIdFromResult(codeCheck) === 'code-check-gb50011'
    && hasGlobalSeismicCodeCheckDetail(codeCheck);
}

function analysisWorkflowInputModeFromResult(analysis: unknown): string | undefined {
  if (!isRecord(analysis)) return undefined;
  const data = getAnalysisPayload(analysis);
  return pickStringLike(data, 'workflowInputMode') ?? pickStringLike(analysis, 'workflowInputMode') ?? undefined;
}

function compactText(
  value: unknown,
  limit = ANALYSIS_MESSAGE_LIMIT,
  mode: TextCompaction = 'middle',
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length <= limit) return text;
  const omitted = text.length - limit;
  if (mode === 'tail') {
    const marker = `...[truncated ${omitted} chars]\n`;
    const tailLength = Math.max(0, limit - marker.length);
    return `${marker}${text.slice(-tailLength)}`;
  }
  const marker = `\n...[truncated ${omitted} chars]...\n`;
  const bodyLength = Math.max(0, limit - marker.length);
  const headLength = Math.ceil(bodyLength * 0.35);
  const tailLength = bodyLength - headLength;
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function normalizeAnalysisErrorCode(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return 'ANALYSIS_EXECUTION_FAILED';
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function countRecordEntries(value: unknown): number | undefined {
  return isRecord(value) ? Object.keys(value).length : undefined;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function pickNumberLike(record: Record<string, unknown>, key: string): number | string | null | undefined {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return undefined;
}

function pickStringLike(record: Record<string, unknown>, key: string): string | null | undefined {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function omitEmptyRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function compactFinalCompliance(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return undefined;
  return omitEmptyRecord({
    status: pickStringLike(record, 'status'),
    utilization: pickNumberLike(record, 'utilization'),
    driftRatio: pickNumberLike(record, 'driftRatio'),
    limitDriftRatio: pickNumberLike(record, 'limitDriftRatio'),
    source: pickStringLike(record, 'source'),
    scope: pickStringLike(record, 'scope'),
  });
}

function compactCapabilityAssessment(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const source = optionalRecord(data.capabilityAssessment) ?? data;
  const implementedCapabilities = (
    Array.isArray(source.implementedCapabilities)
      ? source.implementedCapabilities
      : []
  ).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const missingCapabilities = (
    Array.isArray(source.missingCapabilities)
      ? source.missingCapabilities
      : Array.isArray(data.missingCapabilities)
        ? data.missingCapabilities
        : []
  ).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const finalComplianceSupported = typeof source.finalComplianceSupported === 'boolean'
    ? source.finalComplianceSupported
    : undefined;

  return omitEmptyRecord({
    finalComplianceSupported,
    implementedCapabilityCount: implementedCapabilities.length > 0 ? implementedCapabilities.length : undefined,
    implementedCapabilities: implementedCapabilities.length > 0 ? implementedCapabilities.slice(0, 8) : undefined,
    missingCapabilityCount: missingCapabilities.length > 0 ? missingCapabilities.length : undefined,
    missingCapabilities: missingCapabilities.length > 0 ? missingCapabilities.slice(0, 8) : undefined,
  });
}

function compactSpecialSystemReview(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const review = optionalRecord(data.specialSystemReview);
  if (!review) return undefined;
  const systems = Array.isArray(review.systems)
    ? review.systems.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const missingInputs = Array.isArray(review.missingInputs)
    ? review.missingInputs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const capabilityBoundaries = Array.isArray(review.capabilityBoundaries)
    ? review.capabilityBoundaries.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const checks = Array.isArray(review.checks)
    ? review.checks.filter(isRecord)
    : [];
  const isolationEstimate = optionalRecord(review.isolationEquivalentLinearEstimate);
  const isolationFinalCompliance = optionalRecord(isolationEstimate?.finalCompliance);
  const isolationTimeHistoryEstimate = optionalRecord(review.isolationLayerTimeHistoryEstimate);
  const isolationTimeHistoryFinalCompliance = optionalRecord(isolationTimeHistoryEstimate?.finalCompliance);
  const energyEstimate = optionalRecord(review.energyDissipationEquivalentEstimate);
  const energyFinalCompliance = optionalRecord(energyEstimate?.finalCompliance);
  const energyTimeHistoryEstimate = optionalRecord(review.energyDissipationTimeHistoryEstimate);
  const energyTimeHistoryFinalCompliance = optionalRecord(energyTimeHistoryEstimate?.finalCompliance);
  const failedChecks = checks
    .filter((check) => pickStringLike(check, 'status') === 'fail')
    .map((check) => pickStringLike(check, 'item'))
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  return omitEmptyRecord({
    reviewRequired: typeof review.reviewRequired === 'boolean' ? review.reviewRequired : undefined,
    status: pickStringLike(review, 'status'),
    systems: systems.length > 0 ? systems : undefined,
    missingInputs: missingInputs.length > 0 ? missingInputs.slice(0, 8) : undefined,
    capabilityBoundaries: capabilityBoundaries.length > 0 ? capabilityBoundaries.slice(0, 8) : undefined,
    deviceCounts: optionalRecord(review.deviceCounts),
    checkCount: checks.length > 0 ? checks.length : undefined,
    failedCheckCount: pickNumberLike(review, 'failedCheckCount') ?? (failedChecks.length > 0 ? failedChecks.length : undefined),
    failedChecks: failedChecks.length > 0 ? failedChecks.slice(0, 5) : undefined,
    isolationEquivalentLinearEstimate: isolationEstimate ? omitEmptyRecord({
      status: pickStringLike(isolationEstimate, 'status'),
      periodSec: pickNumberLike(isolationEstimate, 'periodSec'),
      alpha: pickNumberLike(isolationEstimate, 'alpha'),
      baseShearKN: pickNumberLike(isolationEstimate, 'baseShearKN'),
      displacementDemandM: pickNumberLike(isolationEstimate, 'displacementDemandM'),
      displacementCapacityM: pickNumberLike(isolationEstimate, 'displacementCapacityM'),
      displacementUtilization: pickNumberLike(isolationEstimate, 'displacementUtilization'),
      finalCompliance: compactFinalCompliance(isolationFinalCompliance),
    }) : undefined,
    isolationLayerTimeHistoryEstimate: isolationTimeHistoryEstimate ? omitEmptyRecord({
      status: pickStringLike(isolationTimeHistoryEstimate, 'status'),
      periodSec: pickNumberLike(isolationTimeHistoryEstimate, 'periodSec'),
      recordCount: pickNumberLike(isolationTimeHistoryEstimate, 'recordCount'),
      controllingRecord: pickStringLike(isolationTimeHistoryEstimate, 'controllingRecord'),
      maxDisplacementM: pickNumberLike(isolationTimeHistoryEstimate, 'maxDisplacementM'),
      maxBaseShearKN: pickNumberLike(isolationTimeHistoryEstimate, 'maxBaseShearKN'),
      displacementCapacityM: pickNumberLike(isolationTimeHistoryEstimate, 'displacementCapacityM'),
      displacementUtilization: pickNumberLike(isolationTimeHistoryEstimate, 'displacementUtilization'),
      finalCompliance: compactFinalCompliance(isolationTimeHistoryFinalCompliance),
    }) : undefined,
    energyDissipationEquivalentEstimate: energyEstimate ? omitEmptyRecord({
      status: pickStringLike(energyEstimate, 'status'),
      periodSec: pickNumberLike(energyEstimate, 'periodSec'),
      baseDampingRatio: pickNumberLike(energyEstimate, 'baseDampingRatio'),
      additionalDampingRatio: pickNumberLike(energyEstimate, 'additionalDampingRatio'),
      equivalentDampingRatio: pickNumberLike(energyEstimate, 'equivalentDampingRatio'),
      demandReductionRatio: pickNumberLike(energyEstimate, 'demandReductionRatio'),
      adjustedDisplacementDemandM: pickNumberLike(energyEstimate, 'adjustedDisplacementDemandM'),
      deformationCapacityM: pickNumberLike(energyEstimate, 'deformationCapacityM'),
      deformationUtilization: pickNumberLike(energyEstimate, 'deformationUtilization'),
      finalCompliance: compactFinalCompliance(energyFinalCompliance),
    }) : undefined,
    energyDissipationTimeHistoryEstimate: energyTimeHistoryEstimate ? omitEmptyRecord({
      status: pickStringLike(energyTimeHistoryEstimate, 'status'),
      periodSec: pickNumberLike(energyTimeHistoryEstimate, 'periodSec'),
      recordCount: pickNumberLike(energyTimeHistoryEstimate, 'recordCount'),
      controllingRecord: pickStringLike(energyTimeHistoryEstimate, 'controllingRecord'),
      maxDeviceDeformationM: pickNumberLike(energyTimeHistoryEstimate, 'maxDeviceDeformationM'),
      maxDeviceForceKN: pickNumberLike(energyTimeHistoryEstimate, 'maxDeviceForceKN'),
      deformationCapacityM: pickNumberLike(energyTimeHistoryEstimate, 'deformationCapacityM'),
      deformationUtilization: pickNumberLike(energyTimeHistoryEstimate, 'deformationUtilization'),
      forceCapacityKN: pickNumberLike(energyTimeHistoryEstimate, 'forceCapacityKN'),
      forceUtilization: pickNumberLike(energyTimeHistoryEstimate, 'forceUtilization'),
      finalCompliance: compactFinalCompliance(energyTimeHistoryFinalCompliance),
    }) : undefined,
  });
}

function pickAnalysisDiagnostics(
  result: Record<string, unknown>,
  meta: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const diagnostics: Record<string, unknown> = {};
  const copy = (targetKey: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    const isTail = targetKey.endsWith('Tail');
    diagnostics[targetKey] = typeof value === 'string'
      ? compactText(value, 2000, isTail ? 'tail' : 'middle') ?? value
      : value;
  };

  copy('engineId', meta.engineId);
  copy('engineName', meta.engineName);
  copy('exceptionType', meta.exceptionType);
  copy('analysisSkillId', meta.analysisSkillId);
  copy('analysisAdapterKey', meta.analysisAdapterKey);
  copy('workDir', meta.workDir);
  copy('runMetaPath', meta.runMetaPath);
  copy('driverResultPath', meta.driverResultPath);
  copy('driverOutputPath', meta.driverOutputPath);
  copy('stdoutPath', meta.stdoutPath);
  copy('stderrPath', meta.stderrPath);
  copy('stdoutTail', meta.stdoutTail);
  copy('stderrTail', meta.stderrTail);
  copy('stepsTail', meta.stepsTail);
  copy('message', result.message);

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

function compactFloorLoadTransferSummary(
  data: Record<string, unknown>,
  result: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const source = optionalRecord(data.floorLoadTransfer) ?? optionalRecord(result.floorLoadTransfer);
  if (!source) return undefined;

  const rawWarnings = Array.isArray(source.warnings) ? source.warnings : [];
  const warnings = rawWarnings
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5)
    .map((value) => compactText(value, 500) ?? value);

  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems
    .filter(isRecord)
    .slice(0, 8)
    .map((item) => omitEmptyRecord({
      story: pickStringLike(item, 'story'),
      panelId: pickStringLike(item, 'panelId'),
      requestedMode: pickStringLike(item, 'requestedMode'),
      effectiveMode: pickStringLike(item, 'effectiveMode'),
      method: pickStringLike(item, 'method'),
      methodEn: pickStringLike(item, 'methodEn'),
      methodZh: pickStringLike(item, 'methodZh'),
      designCodeRule: pickStringLike(item, 'designCodeRule'),
      designCodeRuleEn: pickStringLike(item, 'designCodeRuleEn'),
      designCodeRuleZh: pickStringLike(item, 'designCodeRuleZh'),
      generatedLoadType: pickStringLike(item, 'generatedLoadType'),
      generatedLoadCount: pickNumberLike(item, 'generatedLoadCount'),
      loadIntensityKNPerM2: pickNumberLike(item, 'loadIntensityKNPerM2'),
      totalLoadKN: pickNumberLike(item, 'totalLoadKN'),
      spanX: pickNumberLike(item, 'spanX'),
      spanY: pickNumberLike(item, 'spanY'),
      longShortRatio: pickNumberLike(item, 'longShortRatio'),
      note: pickStringLike(item, 'note'),
      noteEn: pickStringLike(item, 'noteEn'),
      noteZh: pickStringLike(item, 'noteZh'),
    }))
    .filter((item): item is Record<string, unknown> => !!item);

  return omitEmptyRecord({
    requestedMode: pickStringLike(source, 'requestedMode'),
    effectiveMode: pickStringLike(source, 'effectiveMode'),
    method: pickStringLike(source, 'method'),
    methodEn: pickStringLike(source, 'methodEn'),
    methodZh: pickStringLike(source, 'methodZh'),
    designCode: pickStringLike(source, 'designCode'),
    loadSource: pickStringLike(source, 'loadSource'),
    itemCount: rawItems.length > 0 ? rawItems.length : undefined,
    items: items.length > 0 ? items : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}

function buildSuccessfulAnalysisDetails(data: Record<string, unknown>, result: Record<string, unknown>) {
  const summary = optionalRecord(data.summary);
  const envelope = optionalRecord(data.envelope);
  const responseSpectrumFinalCompliance = optionalRecord(data.responseSpectrumFinalCompliance);
  const elasticStoryDriftFinalCompliance = optionalRecord(data.elasticStoryDriftFinalCompliance);
  const elasticPlasticTimeHistory = optionalRecord(data.elasticPlasticTimeHistory);
  const pushover = optionalRecord(data.pushover);
  const caseResults = optionalRecord(data.caseResults);
  const loadCases = optionalRecord(data.loadCases);
  const combinations = optionalRecord(data.combinations);

  const counts = omitEmptyRecord({
    nodeCount: firstDefined(
      summary ? pickNumberLike(summary, 'nodeCount') : undefined,
      countRecordEntries(data.displacements),
    ),
    elementCount: firstDefined(
      summary ? pickNumberLike(summary, 'elementCount') : undefined,
      countRecordEntries(data.forces),
    ),
    reactionNodeCount: firstDefined(
      summary ? pickNumberLike(summary, 'reactionNodeCount') : undefined,
      countRecordEntries(data.reactions),
    ),
    loadCaseCount: firstDefined(
      summary ? pickNumberLike(summary, 'loadCaseCount') : undefined,
      countRecordEntries(caseResults),
      countRecordEntries(loadCases),
    ),
    combinationCount: firstDefined(
      summary ? pickNumberLike(summary, 'combinationCount') : undefined,
      countRecordEntries(combinations),
    ),
  });

  const keyMetrics = envelope ? omitEmptyRecord({
    maxAbsDisplacement: pickNumberLike(envelope, 'maxAbsDisplacement'),
    maxAbsAxialForce: pickNumberLike(envelope, 'maxAbsAxialForce'),
    maxAbsShearForce: pickNumberLike(envelope, 'maxAbsShearForce'),
    maxAbsMoment: pickNumberLike(envelope, 'maxAbsMoment'),
    maxAbsReaction: pickNumberLike(envelope, 'maxAbsReaction'),
    maxBaseShear: pickNumberLike(envelope, 'maxBaseShear'),
    maxStoryDriftRatio: pickNumberLike(envelope, 'maxStoryDriftRatio'),
    modalMassParticipationRatio: pickNumberLike(envelope, 'modalMassParticipationRatio'),
  }) : undefined;

  const controlling = envelope ? omitEmptyRecord({
    controlNodeDisplacement: pickStringLike(envelope, 'controlNodeDisplacement'),
    controlElementAxialForce: pickStringLike(envelope, 'controlElementAxialForce'),
    controlElementShearForce: pickStringLike(envelope, 'controlElementShearForce'),
    controlElementMoment: pickStringLike(envelope, 'controlElementMoment'),
    controlNodeReaction: pickStringLike(envelope, 'controlNodeReaction'),
  }) : undefined;
  const compliance = omitEmptyRecord({
    responseSpectrumDrift: compactFinalCompliance(responseSpectrumFinalCompliance),
    elasticStoryDrift: compactFinalCompliance(elasticStoryDriftFinalCompliance),
    elasticPlasticTimeHistory: compactFinalCompliance(optionalRecord(elasticPlasticTimeHistory?.finalCompliance)),
    pushover: compactFinalCompliance(optionalRecord(pushover?.finalCompliance)),
  });

  const rawWarnings = Array.isArray(data.warnings)
    ? data.warnings
    : Array.isArray(result.warnings)
      ? result.warnings
      : [];
  const warnings = rawWarnings
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5)
    .map((value) => compactText(value, 500) ?? value);

  return omitEmptyRecord({
    workflowInputMode: pickStringLike(data, 'workflowInputMode') ?? pickStringLike(result, 'workflowInputMode'),
    counts,
    keyMetrics,
    controlling,
    compliance,
    capabilityAssessment: compactCapabilityAssessment(data),
    specialSystemReview: compactSpecialSystemReview(data),
    floorLoadTransfer: compactFloorLoadTransferSummary(data, result),
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}

function getAnalysisPayload(result: Record<string, unknown>): Record<string, unknown> {
  return isRecord(result.data) ? result.data : result;
}

export function buildAnalysisToolSummary(args: {
  result: unknown;
  skillId?: string;
}): Record<string, unknown> {
  const result = isRecord(args.result) ? args.result : {};
  const meta = isRecord(result.meta) ? result.meta : {};
  const data = getAnalysisPayload(result);
  const status = typeof result.status === 'string' ? result.status : undefined;
  const success = result.success !== false && status !== 'error';

  if (!success) {
    const errorCode = normalizeAnalysisErrorCode(result.error_code, result.errorCode);
    const diagnostics = pickAnalysisDiagnostics(result, meta);
    return {
      success: false,
      skillId: args.skillId,
      errorCode,
      message: compactText(result.message) || 'Analysis execution failed',
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  return {
    success: true,
    skillId: args.skillId,
    analysisMode: data?.analysisMode,
    ...(buildSuccessfulAnalysisDetails(data, result) ?? {}),
  };
}

export function buildModelToolSummary(
  model: Record<string, unknown>,
  locale: 'zh' | 'en' = 'zh',
): Record<string, unknown> {
  const nodeCount = Array.isArray(model.nodes) ? model.nodes.length : 0;
  const elementCount = Array.isArray(model.elements) ? model.elements.length : 0;
  const schemaVersion = model.schema_version;

  if (nodeCount === 0 || elementCount === 0) {
    return {
      success: false,
      errorCode: 'EMPTY_MODEL',
      message: locale === 'zh'
        ? '模型构建结果为空，未生成可分析的节点或单元。请重新提取参数或补充结构连接信息。'
        : 'Model build returned an empty model with no analyzable nodes or elements. Re-extract parameters or provide structural connectivity.',
      nodeCount,
      elementCount,
      schemaVersion,
    };
  }

  return {
    success: true,
    nodeCount,
    elementCount,
    schemaVersion,
    nextAction: 'run_analysis',
    message: locale === 'zh'
      ? '模型已构建完成。下一步必须调用 run_analysis 执行结构分析。'
      : 'Model build is complete. Next, call run_analysis to execute the structural analysis.',
  };
}

export function buildModelToolStateUpdate(
  model: Record<string, unknown>,
  summary: Record<string, unknown>,
): Partial<AgentState> {
  if (summary.success === false) {
    return {
      model: null,
      analysisResult: null,
      codeCheckResult: null,
      report: null,
    };
  }
  return { model };
}

async function resolveExistingDraftPlugin(
  skillRuntime: AgentSkillRuntime,
  existingState: DraftState,
  skillIds: string[] | undefined,
  fallbackPlugin: AgentSkillPlugin | null,
): Promise<AgentSkillPlugin | null> {
  const pluginBySkill = existingState.skillId
    ? await skillRuntime.resolvePluginForType(existingState.skillId, skillIds)
    : null;
  if (pluginBySkill) {
    return pluginBySkill;
  }

  const pluginByType = await skillRuntime.resolvePluginForType(existingState.inferredType, skillIds);
  if (pluginByType) {
    return pluginByType;
  }

  return fallbackPlugin?.id === 'generic' ? fallbackPlugin : null;
}

// ---------------------------------------------------------------------------
// Engineering tools (wrap AgentSkillRuntime)
// ---------------------------------------------------------------------------

function detectStructuralTypeWithConfiguredLlm(
  skillRuntime: AgentSkillRuntime,
  args: {
    message: string;
    locale: 'zh' | 'en';
    currentState?: DraftState;
    skillIds?: string[];
  },
): Promise<StructuralTypeMatch> {
  const routerLlm = createChatModel(0, { disableStreaming: true });
  return skillRuntime.detectStructuralTypeWithLlm(
    routerLlm,
    args.message,
    args.locale,
    args.currentState,
    args.skillIds,
  );
}

export function createDetectStructureTypeTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: { message?: string; locale?: string }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);
      const skillIds = configurable.skillScope;
      const locale = (input.locale === 'en' ? 'en' : (state?.locale || 'zh')) as 'zh' | 'en';
      const message = resolveToolInputMessage(input.message, state?.lastUserMessage, state?.messages);
      const detectionMessage = resolveRetryTaskMessage(message);
      try {
        const match = await detectStructuralTypeWithConfiguredLlm(skillRuntime, {
          message: detectionMessage,
          locale,
          currentState: state?.draftState || undefined,
          skillIds,
        });
        const result = {
          key: match.key,
          mappedType: match.mappedType,
          skillId: match.skillId,
          routingSource: match.routingSource,
          supportLevel: match.supportLevel,
          supportNote: match.supportNote,
          nextAction: 'extract_draft_params',
          instruction: locale === 'zh'
            ? '结构类型已识别。若用户请求建模、分析或报告，下一步调用 extract_draft_params；不要只输出结构类型后停止。'
            : 'Structural type detected. If the user requested modeling, analysis, or reporting, call extract_draft_params next; do not stop after reporting the type.',
        };
        const stateUpdate: Partial<AgentState> = {};
        if (match.key) stateUpdate.structuralTypeKey = match.key;
        logToolCall(log, { tool: 'detect_structure_type', durationMs: Date.now() - start, extra: { matchedKey: match.key, skillId: match.skillId, routingSource: match.routingSource } });
        return toolResult(toolCallId, 'detect_structure_type', JSON.stringify(result), stateUpdate);
      } catch (error) {
        logToolCall(log, { tool: 'detect_structure_type', durationMs: Date.now() - start, success: false, extra: { error: error instanceof Error ? error.message : String(error) } });
        throw error;
      }
    },
    {
      name: 'detect_structure_type',
      description:
        'Detect the structural type (beam, truss, frame, portal-frame, etc.) from a user description. ' +
        'Returns the matched type key, mapped model type, and the skill ID to use for further processing.',
      schema: z.object({
        message: z.string().describe('The user message describing the structure').optional(),
        locale: z.enum(['zh', 'en']).optional().describe('User locale (defaults to session locale)'),
      }),
    },
  );
}

export function createExtractDraftParamsTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      message?: string;
      locale?: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      const existingState = state?.draftState || undefined;
      const skillIds = configurable.skillScope;
      const locale = (input.locale === 'en' ? 'en' : (state?.locale || 'zh')) as 'zh' | 'en';
      const message = resolveToolInputMessage(input.message, state?.lastUserMessage, state?.messages);
      const extractionMessage = resolveRetryTaskMessage(message);

      try {
        // Step 1: Detect structural type
        log.debug({
          hasLastUserMessage: !!state?.lastUserMessage,
          messageCount: Array.isArray(state?.messages) ? state.messages.length : 0,
          inputMessagePreview: input.message?.slice(0, 120),
          resolvedMessagePreview: message.slice(0, 120),
          extractionMessagePreview: extractionMessage.slice(0, 120),
        }, 'extract_draft_params resolved message');
        const match = await detectStructuralTypeWithConfiguredLlm(skillRuntime, {
          message: extractionMessage,
          locale,
          currentState: existingState,
          skillIds,
        });
        const matchedPlugin = match.skillId
          ? await skillRuntime.resolvePluginForType(match.skillId, skillIds)
          : null;
        log.debug({
          detectedKey: match.key,
          detectedSkillId: match.skillId,
          routingSource: match.routingSource,
          matchedPluginId: matchedPlugin?.id,
        }, 'extract_draft_params structural match');

        if (shouldPreserveExistingDraftState(existingState, match, message)) {
          const preservationPlugin = await resolveExistingDraftPlugin(
            skillRuntime,
            existingState,
            skillIds,
            matchedPlugin,
          );
          const preserved = buildPreservedDraftExtractionResult({
            existingState,
            structuralTypeMatch: match,
            plugin: preservationPlugin,
            locale,
          });
          logToolCall(log, {
            tool: 'extract_draft_params',
            durationMs: Date.now() - start,
            extra: {
              preservedExistingDraft: true,
              previousSkillId: existingState.skillId,
              rejectedSkillId: match.skillId,
              rejectedKey: match.key,
              rejectedRoutingSource: match.routingSource,
            },
          });
          return toolResult(
            toolCallId,
            'extract_draft_params',
            JSON.stringify(preserved.responseJson),
            preserved.stateUpdate,
          );
        }

        // Early return when no skill matched
        if (!match.skillId) {
          const nextState = {
            ...(existingState || { inferredType: 'unknown' as const }),
            structuralTypeKey: match.key,
            supportLevel: match.supportLevel,
            supportNote: match.supportNote,
            routingSource: match.routingSource,
            updatedAt: Date.now(),
          };
          const responseJson = {
            nextState,
            criticalMissing: ['inferredType'],
            optionalMissing: [],
            clarificationQuestions: [],
            structuralTypeMatch: match,
            skillId: undefined,
            routingSource: match.routingSource,
            extractionMode: 'deterministic',
            ...buildDraftProgress(locale, ['inferredType']),
          };
          const stateUpdate: Partial<AgentState> = { draftState: nextState };
          if (match.key) stateUpdate.structuralTypeKey = match.key;
          logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: undefined, criticalMissing: 1, routingSource: match.routingSource } });
          return toolResult(toolCallId, 'extract_draft_params', JSON.stringify(responseJson), stateUpdate);
        }

        // Step 2: Resolve plugin
        const plugin = matchedPlugin;
        if (!plugin) {
          const nextState: DraftState = existingState == null
            ? { inferredType: 'unknown' as const, routingSource: match.routingSource, updatedAt: Date.now() }
            : { ...(existingState as DraftState), routingSource: match.routingSource, updatedAt: Date.now() };
          const responseJson = {
            nextState,
            criticalMissing: ['inferredType'],
            optionalMissing: [],
            clarificationQuestions: [],
            structuralTypeMatch: match,
            skillId: undefined,
            routingSource: match.routingSource,
            extractionMode: 'deterministic',
            ...buildDraftProgress(locale, ['inferredType']),
          };
          logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: match.skillId, pluginResolved: false, routingSource: match.routingSource } });
          return toolResult(toolCallId, 'extract_draft_params', JSON.stringify(responseJson), { draftState: nextState });
        }

        // Generic skill: deterministic path (no LLM extraction needed)
        const stableExistingState = hasStableDraftType(existingState) ? existingState : undefined;
        if (plugin.id === 'generic' && stableExistingState) {
          const { withStructuralTypeState } = await import('../agent-runtime/plugin-helpers.js');
          const resetToGeneric = isFreshGenericStructuralRoute(match);
          const nextState = withStructuralTypeState(
            plugin.handler.mergeState(resetToGeneric ? undefined : stableExistingState, resetToGeneric ? { inferredType: 'unknown' } : {}),
            match,
          );
          const missing = plugin.handler.computeMissing(nextState, 'execution');
          const responseJson = {
            nextState,
            criticalMissing: missing.critical,
            optionalMissing: missing.optional,
            clarificationQuestions: buildClarificationQuestions(plugin, missing.critical, missing.optional, nextState, locale),
            structuralTypeMatch: match,
            skillId: plugin.id,
            routingSource: match.routingSource,
            extractionMode: 'deterministic',
            ...buildDraftProgress(locale, missing.critical),
          };
          const stateUpdate: Partial<AgentState> = { draftState: nextState, structuralTypeKey: match.key };
          logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: plugin.id, extractionMode: 'deterministic', criticalMissing: missing.critical.length, routingSource: match.routingSource } });
          return toolResult(toolCallId, 'extract_draft_params', JSON.stringify(responseJson), stateUpdate);
        }

        // Step 3: Sub-agent extracts parameters (skill manifest driven)
        const { invokeParamExtractor } = await import('./param-extractor.js');
        let draftPatch = await invokeParamExtractor({
          message: extractionMessage,
          existingState,
          locale,
          plugin,
          traceLogger: log,
        });

        // Step 4: Handler pipeline (extractDraft → mergeState → computeMissing)
        let patch = plugin.handler.extractDraft({
          message: extractionMessage,
          locale,
          currentState: existingState,
          llmDraftPatch: draftPatch,
          structuralTypeMatch: match,
        });
        const { withStructuralTypeState } = await import('../agent-runtime/plugin-helpers.js');
        let nextState = withStructuralTypeState(plugin.handler.mergeState(existingState, patch), match);
        let missing = plugin.handler.computeMissing(nextState, 'execution');
        let extractionMode = draftPatch ? 'llm' : 'deterministic';

        if (draftPatch && missing.critical.length > 0) {
          const retryDraftPatch = await invokeParamExtractor({
            message: extractionMessage,
            existingState: nextState,
            locale,
            plugin,
            focusFields: missing.critical,
            traceLogger: log,
          });
          if (retryDraftPatch) {
            const retryPatch = plugin.handler.extractDraft({
              message: extractionMessage,
              locale,
              currentState: nextState,
              llmDraftPatch: retryDraftPatch,
              structuralTypeMatch: match,
            });
            const retryState = withStructuralTypeState(plugin.handler.mergeState(nextState, retryPatch), match);
            const retryMissing = plugin.handler.computeMissing(retryState, 'execution');
            if (retryMissing.critical.length < missing.critical.length) {
              draftPatch = retryDraftPatch;
              patch = retryPatch;
              nextState = retryState;
              missing = retryMissing;
              extractionMode = 'llm-focused-retry';
            }
          }
        }

        const responseJson = {
          nextState,
          criticalMissing: missing.critical,
          optionalMissing: missing.optional,
          clarificationQuestions: buildClarificationQuestions(plugin, missing.critical, missing.optional, nextState, locale),
          structuralTypeMatch: match,
          skillId: plugin.id,
          routingSource: match.routingSource,
          extractionMode,
          llmDraftPatch: draftPatch ?? null,
          engineeringDraft: nextState.engineeringDraft ?? patch.engineeringDraft ?? null,
          extractionSource: typeof nextState.skillState?.extractionSource === 'string'
            ? nextState.skillState.extractionSource
            : (draftPatch ? 'llm-draft-patch' : 'deterministic'),
          ...buildDraftProgress(locale, missing.critical),
        };

        const stateUpdate: Partial<AgentState> = {};
        if (nextState) stateUpdate.draftState = nextState;
        if (match.key) stateUpdate.structuralTypeKey = match.key;

        logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: plugin.id, extractionMode: responseJson.extractionMode, criticalMissing: missing.critical.length, routingSource: match.routingSource } });
        return toolResult(
          toolCallId,
          'extract_draft_params',
          JSON.stringify(responseJson),
          stateUpdate,
        );
      } catch (error) {
        logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, success: false, extra: { error: error instanceof Error ? error.message : String(error) } });
        throw error;
      }
    },
    {
      name: 'extract_draft_params',
      description:
        'Extract structural engineering parameters from a user message and merge them into the draft state. ' +
        'Reads existing draft state from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns updated draft state, missing fields, and the matched structural type.',
      schema: z.object({
        message: z.string().describe('The user message to extract parameters from').optional(),
        locale: z.enum(['zh', 'en']).optional().describe('User locale'),
      }),
    },
  );
}

export function createBuildModelTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (_input: Record<string, unknown>, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      // Read draft state from graph state channel
      const draftState = state?.draftState;
      if (!draftState) {
        throw new Error('No draft state available. Run extract_draft_params first.');
      }
      const skillIds = configurable.skillScope;

      const model = await skillRuntime.buildModel(draftState, skillIds, {
        message: state?.lastUserMessage || '',
        locale: state?.locale || 'zh',
      });
      if (!model) {
        logToolCall(log, { tool: 'build_model', durationMs: Date.now() - start, extra: { success: false } });
        throw new Error('Model build returned undefined — draft may be incomplete. Try running extract_draft_params again with more explicit parameters.');
      }

      // Store model in graph state via Command.
      // Keep ToolMessage content compact — full model lives in graph state.
      // The streaming layer reads model from nodeState for artifact_payload_sync.
      const summary = buildModelToolSummary(model, state?.locale || 'zh');
      const success = summary.success !== false;
      logToolCall(log, { tool: 'build_model', durationMs: Date.now() - start, success, extra: summary });
      return toolResult(
        toolCallId,
        'build_model',
        JSON.stringify(summary),
        buildModelToolStateUpdate(model, summary),
      );
    },
    {
      name: 'build_model',
      description:
        'Build a computable structural model from the current draft state. ' +
        'Reads draft state from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns the model if all critical parameters are present, or an error if the draft is incomplete.',
      schema: z.object({}),
    },
  );
}

export function createAskUserClarificationTool() {
  return tool(
    async (input: { question: string; optionsJson?: string }) => {
      const options = input.optionsJson
        ? JSON.parse(input.optionsJson) as string[]
        : undefined;

      const userResponse = interrupt({
        type: 'clarification_needed',
        question: input.question,
        options,
      }) as string;

      return JSON.stringify({
        type: 'clarification_answered',
        question: input.question,
        answer: userResponse,
        nextAction: 'extract_draft_params',
        instruction: 'Clarification answers are not merged into draftState automatically. Call extract_draft_params with this exact answer before build_model.',
      });
    },
    {
      name: 'ask_user_clarification',
      description:
        'Pause execution and ask the user a clarification question. ' +
        'Use this when you cannot proceed without user input. ' +
        'The graph will resume once the user provides an answer.',
      schema: z.object({
        question: z.string().describe('The question to ask the user'),
        optionsJson: z
          .string()
          .optional()
          .describe('JSON array of suggested answer options'),
      }),
    },
  );
}

export function createSetSessionConfigTool() {
  return tool(
    async (input: {
      analysisType?: string;
      designCode?: string;
      skillIdsJson?: string;
    }, config: LangGraphRunnableConfig) => {
      const state = getConfigurable(config).agentState;
      const toolCallId = getToolCallId(config);

      const updatedKeys: string[] = [];
      const stateUpdate: Partial<AgentState> = {};
      const existingSkillIds = Array.isArray(state?.selectedSkillIds)
        ? state.selectedSkillIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      let nextSkillIds: string[] | undefined;

      if (input.analysisType) {
        stateUpdate.policy = {
          ...(state?.policy || {}),
          analysisType: input.analysisType as 'static' | 'dynamic' | 'seismic' | 'nonlinear',
        };
        updatedKeys.push('analysisType');
      }
      if (input.designCode) {
        stateUpdate.policy = {
          ...(state?.policy || {}),
          ...(stateUpdate.policy || {}),
          designCode: input.designCode,
        };
        updatedKeys.push('designCode');
      }
      if (input.skillIdsJson) {
        const parsedSkillIds = parseSkillIdsJson(input.skillIdsJson);
        if (!parsedSkillIds.ok) {
          return toolResult(toolCallId, 'set_session_config', JSON.stringify({
            success: false,
            error_code: 'INVALID_SKILL_IDS_JSON',
            message: parsedSkillIds.error,
          }));
        }
        nextSkillIds = parsedSkillIds.value;
      }

      const nextAnalysisType = stateUpdate.policy?.analysisType ?? state?.policy?.analysisType;
      const nextDesignCode = stateUpdate.policy?.designCode ?? state?.policy?.designCode;
      const skillIdsForDecision = nextSkillIds ?? existingSkillIds;
      if (nextSkillIds !== undefined) {
        stateUpdate.selectedSkillIds = isChinaSeismicSessionConfig({
          analysisType: nextAnalysisType,
          designCode: nextDesignCode,
          skillIds: nextSkillIds,
        })
          ? completeChinaSeismicSkillIds(nextSkillIds)
          : uniqueStrings(nextSkillIds);
        updatedKeys.push('selectedSkillIds');
      } else if (isChinaSeismicSessionConfig({
        analysisType: nextAnalysisType,
        designCode: nextDesignCode,
        skillIds: skillIdsForDecision,
      })) {
        stateUpdate.selectedSkillIds = completeChinaSeismicSkillIds(skillIdsForDecision);
        updatedKeys.push('selectedSkillIds');
      }

      const responseJson = {
        success: true,
        updatedKeys,
        message: `Updated: ${updatedKeys.join(', ') || 'nothing'}`,
      };

      // Only return Command if there are actual updates
      if (updatedKeys.length > 0) {
        return toolResult(toolCallId, 'set_session_config', JSON.stringify(responseJson), stateUpdate);
      }
      return JSON.stringify(responseJson);
    },
    {
      name: 'set_session_config',
      description:
        'Update current-session configuration: analysis type (static/dynamic/seismic/nonlinear), ' +
        'design code (GB50010/GB50011/GB50017), or selected skill IDs. ' +
        'For China seismic analysis, set analysisType to seismic; the tool will keep the workflow-safe baseline skills for modeling, OpenSees seismic analysis, GB50011 code-check, validation, and reporting. ' +
        'This does not create persistent memory.',
      schema: z.object({
        analysisType: z
          .enum(['static', 'dynamic', 'seismic', 'nonlinear'])
          .optional()
          .describe('Analysis type to set'),
        designCode: z
          .string()
          .optional()
          .describe('Design code to set (e.g. GB50017, GB/T 50011-2010-2024)'),
        skillIdsJson: z
          .string()
          .optional()
          .describe('JSON array of skill IDs to select. For China seismic workflows, opensees-seismic or GB50011 selection is auto-completed with the required modeling, code-check, validation, and report baseline skills.'),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Engineering execution tools (wrap AgentSkillRuntime execution methods)
// ---------------------------------------------------------------------------

export function createValidateModelTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: { engineId?: string }, config: LangGraphRunnableConfig) => {
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      // Read model from graph state channel
      const model = state?.model;
      if (!model) {
        return JSON.stringify({ error: 'No model available. Run build_model first.' });
      }
      const skillIds = configurable.skillScope;
      const analysisType = normalizeAnalysisType(state?.policy?.analysisType);
      const unselectedRequestedSkillId = resolveUnselectedRequestedAnalysisSkillId(
        state?.lastUserMessage,
        skillIds,
        analysisType,
      );
      if (unselectedRequestedSkillId) {
        return JSON.stringify(buildAnalysisProviderNotSelectedPayload(unselectedRequestedSkillId));
      }
      const requestedEngineId = resolveRequestedAnalysisEngineId(state?.lastUserMessage, skillIds, analysisType);
      const result = await skillRuntime.executeValidationSkill({
        model,
        engineId: input.engineId || requestedEngineId,
        structureProtocolClient: configurable.structureProtocolClient,
      });
      // Keep output compact — trim large model echo from validation result
      const compact: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
        if (k === 'input') {
          compact[k] = { model: '(model stored in state)' };
        } else {
          compact[k] = v;
        }
      }
      return JSON.stringify(compact);
    },
    {
      name: 'validate_model',
      description:
        'Validate the current structural model for correctness (connectivity, geometry, loads). ' +
        'Reads the model from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns validation errors and warnings.',
      schema: z.object({
        engineId: z.string().optional().describe('Optional analysis engine ID'),
      }),
    },
  );
}

export function createRunAnalysisTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      analysisType: string;
      analysisSkillId?: string;
      floorLoadTransferMode?: 'auto_code_cn' | 'node_tributary' | 'one_way_slab' | 'two_way_slab';
      seismicWorkflowJson?: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      // Read model from graph state channel
      const model = state?.model;
      if (!model) {
        return toolResult(toolCallId, 'run_analysis', JSON.stringify({ error: 'No model available. Run build_model first.' }));
      }
      const skillIds = configurable.skillScope;
      const analysisType = (input.analysisType || 'static') as 'static' | 'dynamic' | 'seismic' | 'nonlinear';
      const unselectedRequestedSkillId = resolveUnselectedRequestedAnalysisSkillId(
        state?.lastUserMessage,
        skillIds,
        analysisType,
        input.analysisSkillId,
      );
      if (unselectedRequestedSkillId) {
        return toolResult(
          toolCallId,
          'run_analysis',
          JSON.stringify(buildAnalysisProviderNotSelectedPayload(unselectedRequestedSkillId)),
        );
      }
      const requestedAnalysisSkillId = resolveRequestedAnalysisSkillId(
        state?.lastUserMessage,
        skillIds,
        analysisType,
        input.analysisSkillId,
      );
      const traceId = `lg-${Date.now()}`;
      const parsedSeismicWorkflow = parseJsonObjectInput(input.seismicWorkflowJson, 'seismicWorkflowJson');
      if (parsedSeismicWorkflow && !parsedSeismicWorkflow.ok) {
        return toolResult(
          toolCallId,
          'run_analysis',
          JSON.stringify({
            success: false,
            error_code: 'INVALID_SEISMIC_WORKFLOW_JSON',
            message: parsedSeismicWorkflow.error,
          }),
        );
      }
      const draftSeismicWorkflow = isRecord(state?.draftState?.skillState?.seismicWorkflow)
        ? state?.draftState?.skillState?.seismicWorkflow as Record<string, unknown>
        : undefined;
      const contextSeismicWorkflow = isRecord(state?.contextSeismicWorkflow)
        ? state.contextSeismicWorkflow
        : undefined;
      const semanticSeismicWorkflow = parsedSeismicWorkflow?.ok
        ? parsedSeismicWorkflow.value
        : draftSeismicWorkflow ?? (
          hasSemanticSeismicWorkflowInput(contextSeismicWorkflow)
            ? contextSeismicWorkflow
            : undefined
        );
      const seismicWorkflow = mergeSeismicWorkflowInputs(
        semanticSeismicWorkflow,
        contextSeismicWorkflow,
      );
      if (analysisType === 'seismic' && !hasSemanticSeismicWorkflowInput(semanticSeismicWorkflow)) {
        return toolResult(
          toolCallId,
          'run_analysis',
          JSON.stringify({
            success: false,
            error_code: 'SEISMIC_WORKFLOW_REQUIRED',
            message: 'China seismic analysis requires a non-empty structured seismicWorkflow from LLM semantic understanding before run_analysis.',
            messageZh: '中国抗震分析必须先由 LLM 语义理解形成非空 seismicWorkflow 结构化对象，不能直接按关键词进入计算。',
            nextAction: 'Call extract_draft_params or pass seismicWorkflowJson, then retry run_analysis.',
          }),
        );
      }
      if (analysisType === 'seismic' && hasStructuredSeismicWorkflow(seismicWorkflow)) {
        const workflowErrors = validateSeismicWorkflowInput(seismicWorkflow);
        if (workflowErrors.length > 0) {
          return toolResult(
            toolCallId,
            'run_analysis',
            JSON.stringify({
              success: false,
              error_code: 'INVALID_SEISMIC_WORKFLOW',
              message: 'China seismic workflow contains invalid structured fields.',
              messageZh: '中国抗震 seismicWorkflow 存在无效结构化字段。',
              errors: workflowErrors,
              nextAction: 'Correct seismicWorkflowJson or rerun extract_draft_params to produce valid structured fields.',
            }),
          );
        }
      }

      const engineClient = configurable.engineClient;
      const postToEngineWithRetry = async (
        p: string,
        payload: Record<string, unknown>,
        opts: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal },
      ) => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= opts.retries; attempt++) {
          if (opts.signal?.aborted) {
            throw opts.signal.reason ?? new Error('Analysis request aborted');
          }
          try {
            return await engineClient.post(p, payload, { signal: opts.signal });
          } catch (error) {
            lastError = error;
            if (opts.signal?.aborted || attempt === opts.retries) throw error;
          }
        }
        throw lastError;
      };

      // engineId is resolved by the selected analysis skill, not from LLM input
      const result = await skillRuntime.executeAnalysisSkill({
        traceId,
        analysisType,
        model,
        parameters: {
          traceId,
          ...(input.floorLoadTransferMode ? { floorLoadTransferMode: input.floorLoadTransferMode } : {}),
          ...(analysisType === 'seismic' && seismicWorkflow ? { seismicWorkflow } : {}),
        },
        analysisSkillId: requestedAnalysisSkillId,
        skillIds,
        postToEngineWithRetry,
        signal: config.signal,
      });
      const analysisResult: Record<string, unknown> = isRecord(result.result)
        ? { ...result.result }
        : { result: result.result };
      const analysisMeta = isRecord(analysisResult.meta) ? analysisResult.meta : {};
      analysisResult.meta = {
        ...analysisMeta,
        traceId,
      };

      // Store analysis result in graph state via Command.
      // Keep ToolMessage content compact — the full data lives in graph state.
      // The streaming layer reads analysisResult from nodeState for artifact_payload_sync.
      const analysisSummary = buildAnalysisToolSummary({
        result: analysisResult,
        skillId: result.skillId,
      });
      const analysisSucceeded = analysisSummary.success !== false;
      logToolCall(log, {
        tool: 'run_analysis',
        durationMs: Date.now() - start,
        success: analysisSucceeded,
        extra: { analysisType, skillId: result.skillId, requestedAnalysisSkillId, success: analysisSucceeded },
      });
      return toolResult(
        toolCallId,
        'run_analysis',
        JSON.stringify(analysisSummary),
        { analysisResult },
      );
    },
    {
      name: 'run_analysis',
      description:
        'Execute a structural analysis (static, dynamic, seismic, or nonlinear). ' +
        'Reads the model from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns analysis results including displacements, forces, and reactions. ' +
        'The analysis engine is resolved from the selected analysis skill automatically. ' +
        'For China seismic analysis, pass seismicWorkflowJson only as the structured result of semantic understanding.',
      schema: z.object({
        analysisType: z
          .enum(['static', 'dynamic', 'seismic', 'nonlinear'])
          .describe('Type of analysis to perform'),
        analysisSkillId: z
          .enum(ANALYSIS_SKILL_ID_VALUES)
          .optional()
          .describe('Optional structured analysis skill ID from LLM semantic understanding or UI selection. Do not infer it from keyword matching.'),
        floorLoadTransferMode: z
          .enum(['auto_code_cn', 'node_tributary', 'one_way_slab', 'two_way_slab'])
          .optional()
          .describe('Optional floor load transfer mode for OpenSees static analysis. Use auto_code_cn by default; set only when the user explicitly requests a method.'),
        seismicWorkflowJson: z
          .string()
          .optional()
          .describe('Optional JSON object produced by LLM semantic understanding for China seismic workflow. Used only when analysisType is seismic; do not infer this from keyword matching. It may include designBasis, designRequirements, structure, methodPreference, direction, and groundMotionSet.records with uploaded CSV headers/rows or AT2/TXT content returned by analyze_file.'),
      }),
    },
  );
}

export function createRunCodeCheckTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      designCode: string;
      engineId?: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);
      const skillIds = configurable.skillScope;
      const selectedDesignCode = skillRuntime.resolveCodeCheckDesignCodeFromSkillIds(skillIds);
      const explicitDesignCode = input.designCode || state?.policy?.designCode;
      const selectedCodeCheckSkillId = selectedDesignCode
        ? skillRuntime.resolveCodeCheckSkillId(selectedDesignCode)
        : undefined;
      const explicitCodeCheckSkillId = explicitDesignCode
        ? skillRuntime.resolveCodeCheckSkillId(explicitDesignCode)
        : undefined;
      const requestedDesignCode = explicitDesignCode
        && (!selectedCodeCheckSkillId || explicitCodeCheckSkillId === selectedCodeCheckSkillId)
        ? explicitDesignCode
        : (selectedDesignCode || explicitDesignCode);
      const codeCheckSkillId = requestedDesignCode
        ? skillRuntime.resolveCodeCheckSkillId(requestedDesignCode)
        : undefined;
      if (!requestedDesignCode || !codeCheckSkillId) {
        const skipped = {
          skipped: true,
          reason: requestedDesignCode
            ? `Unsupported code-check design code: ${requestedDesignCode}.`
            : 'No code-check design code is selected or provided.',
        };
        logToolCall(log, { tool: 'run_code_check', durationMs: Date.now() - start, extra: { skipped: true, reason: skipped.reason } });
        return toolResult(toolCallId, 'run_code_check', JSON.stringify(skipped));
      }

      // Read model and analysis from graph state channels
      const model = state?.model;
      if (!model) {
        return toolResult(toolCallId, 'run_code_check', JSON.stringify({ error: 'No model available. Run build_model first.' }));
      }
      const analysis = state?.analysisResult;
      if (!analysis) {
        return toolResult(toolCallId, 'run_code_check', JSON.stringify({ error: 'No analysis results available. Run run_analysis first.' }));
      }
      const traceId = `lg-cc-${Date.now()}`;

      const result = await skillRuntime.executeCodeCheckSkill({
        codeCheckClient: configurable.codeCheckClient,
        traceId,
        designCode: requestedDesignCode,
        model,
        analysis,
        analysisParameters: {},
        engineId: input.engineId,
        codeCheckSkillId,
      });

      const codeCheckPayload: Record<string, unknown> = isRecord(result.result)
        ? { ...result.result }
        : { result: result.result };
      const meta = isRecord(codeCheckPayload.meta) ? codeCheckPayload.meta : {};
      const analysisTraceId = analysisTraceIdFromResult(analysis);
      if (result.skillId) {
        codeCheckPayload.meta = {
          ...meta,
          codeCheckSkillId: result.skillId,
          ...(analysisTraceId ? { analysisTraceId } : {}),
        };
      } else if (analysisTraceId) {
        codeCheckPayload.meta = {
          ...meta,
          analysisTraceId,
        };
      }

      // Store code check result in graph state via Command
      logToolCall(log, { tool: 'run_code_check', durationMs: Date.now() - start, extra: { designCode: requestedDesignCode, skillId: result.skillId, success: true } });
      return toolResult(
        toolCallId,
        'run_code_check',
        JSON.stringify({ success: true, skillId: result.skillId }),
        { codeCheckResult: codeCheckPayload },
      );
    },
    {
      name: 'run_code_check',
      description:
        'Run code compliance check against a design code (e.g. GB50017, GB50010, GB50011, GB/T 50011-2010-2024). ' +
        'Reads model and analysis results from conversation state automatically — do NOT pass them as parameters. ' +
        'For China seismic analysis, call this after run_analysis and before generate_report with designCode GB/T 50011-2010-2024. ' +
        'Returns pass/fail status for each check.',
      schema: z.object({
        designCode: z
          .string()
          .describe('Design code to check against (GB50010, GB50011, GB/T 50011-2010-2024, GB50017, JGJ3)'),
        engineId: z.string().optional().describe('Optional engine ID'),
      }),
    },
  );
}

export function createGenerateReportTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      message: string;
      analysisType: string;
      locale?: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      // Read analysis, codeCheck, draftState from graph state channels
      const analysis = state?.analysisResult;
      if (!analysis) {
        return toolResult(toolCallId, 'generate_report', JSON.stringify({ error: 'No analysis results available. Run run_analysis first.' }));
      }
      const codeCheck = state?.codeCheckResult || undefined;
      const draftState = state?.draftState || undefined;
      const skillIds = configurable.skillScope;
      const locale = (input.locale === 'en' ? 'en' : (state?.locale || 'zh')) as 'zh' | 'en';
      const analysisType = inferEffectiveAnalysisType(input.analysisType, state);
      const workflowInputMode = analysisWorkflowInputModeFromResult(analysis);
      if (analysisType === 'seismic' && workflowInputMode !== 'structured_seismic_workflow') {
        return toolResult(toolCallId, 'generate_report', JSON.stringify({
          success: false,
          error_code: 'SEISMIC_WORKFLOW_REQUIRED',
          error: 'China seismic reports require analysis results produced from a structured seismicWorkflow, not the lower-level legacy compatibility parameter path.',
          messageZh: '中国抗震计算书必须基于结构化 seismicWorkflow 分析结果生成，不能使用底层旧参数兼容路径生成正式计算书。',
          workflowInputMode: workflowInputMode ?? null,
          nextAction: 'Call extract_draft_params or pass seismicWorkflowJson, rerun run_analysis and run_code_check, then retry generate_report.',
        }));
      }
      if (analysisType === 'seismic' && !hasValidChinaSeismicCodeCheck(codeCheck, analysis)) {
        return toolResult(toolCallId, 'generate_report', JSON.stringify({
          success: false,
          error_code: 'SEISMIC_CODE_CHECK_REQUIRED',
          error: 'China seismic reports require run_code_check with GB/T 50011-2010-2024 after run_analysis. Call run_code_check first, then retry generate_report.',
          messageZh: '中国抗震报告必须先完成 GB/T 50011-2010(2024) 抗震规范校核；请先调用 run_code_check，再重试 generate_report。',
          requiredCodeCheckSkillId: 'code-check-gb50011',
          actualCodeCheckSkillId: codeCheckSkillIdFromResult(codeCheck),
        }));
      }

      const result = await skillRuntime.executeReportSkill({
        message: input.message,
        analysisType,
        analysis,
        codeCheck,
        format: 'both',
        locale,
        draft: draftState,
        skillIds,
      });

      // For PKPM analysis, also generate the dedicated calculation book
      const analysisData = (analysis as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const analysisMode = analysisData?.analysisMode as string | undefined;
      const isPkpm = analysisMode === 'pkpm-satwe'
        || (analysis as Record<string, unknown>)?.meta != null
          && typeof (analysis as Record<string, unknown>).meta === 'object'
          && ((analysis as Record<string, unknown>).meta as Record<string, unknown>)?.analysisAdapterKey === 'builtin-pkpm';
      if (isPkpm && analysisData?.summary) {
        const jwsPath = (analysisData.summary as Record<string, unknown>)?.jws_path as string | undefined;
        if (jwsPath) {
          try {
            const calcbook = await runPkpmCalcbook(jwsPath);
            if (calcbook) {
              if (calcbook.markdown && result.report.json) {
                const jsonReport = result.report.json as Record<string, unknown>;
                jsonReport.calcbookMarkdown = calcbook.markdown;
              }
              if (calcbook.summary?.pdf_path) {
                (result.report as Record<string, unknown>).pdfUrl = `/api/v1/files/serve?path=${encodeURIComponent(calcbook.summary.pdf_path)}`;
              }
            }
          } catch (err) {
            logger.warn({ err }, 'PKPM calcbook generation failed, skipping');
          }
        }
      }

      // Store report in graph state via Command
      logToolCall(log, { tool: 'generate_report', durationMs: Date.now() - start, extra: { analysisType, locale, success: true } });
      return toolResult(
        toolCallId,
        'generate_report',
        JSON.stringify({ success: true, summary: result.report.summary }),
        { report: result.report as unknown as Record<string, unknown> },
      );
    },
    {
      name: 'generate_report',
      description:
        'Generate an engineering report with summary, key metrics, and compliance narrative. ' +
        'Reads analysis results, code check results, and draft state from conversation state automatically — ' +
        'do NOT pass them as parameters. ' +
        'Requires run_analysis to have been called first. ' +
        'For China seismic reports, run_code_check with GB/T 50011-2010-2024 must be called first.',
      schema: z.object({
        message: z.string().describe('Original user message / intent'),
        analysisType: z
          .enum(['static', 'dynamic', 'seismic', 'nonlinear'])
          .describe('Analysis type that was performed'),
        locale: z.enum(['zh', 'en']).optional().describe('Report language'),
      }),
    },
  );
}

