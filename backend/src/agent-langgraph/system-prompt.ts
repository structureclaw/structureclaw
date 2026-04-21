/**
 * Dynamic system prompt builder for the StructureClaw ReAct agent.
 *
 * Assembles the LLM system message from:
 *   - Agent identity and behaviour rules
 *   - Available skill descriptions
 *   - Current DraftState summary
 *   - Pipeline artifact status
 *   - Workspace context
 *   - Safety constraints
 */
import type { BaseMessageLike } from '@langchain/core/messages';
import type { AgentState } from './state.js';
import type { SkillManifest } from '../agent-runtime/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localeLabel(locale: string): string {
  return locale === 'zh' ? '中文' : 'English';
}

function summarizeDraft(state: AgentState): string {
  const ds = state.draftState;
  if (!ds) return localeLabel(state.locale) === '中文' ? '（无草稿状态）' : '(no draft state)';

  const lines: string[] = [];
  if (ds.inferredType) lines.push(`- type: ${ds.inferredType}`);
  if (ds.skillId) lines.push(`- skill: ${ds.skillId}`);
  if (ds.lengthM != null) lines.push(`- length: ${ds.lengthM} m`);
  if (ds.spanLengthM != null) lines.push(`- span: ${ds.spanLengthM} m`);
  if (ds.heightM != null) lines.push(`- height: ${ds.heightM} m`);
  if (ds.storyCount != null) lines.push(`- stories: ${ds.storyCount}`);
  if (ds.bayCount != null) lines.push(`- bays: ${ds.bayCount}`);
  if (ds.loadKN != null) lines.push(`- load: ${ds.loadKN} kN`);
  if (ds.supportType) lines.push(`- support: ${ds.supportType}`);
  return lines.length > 0 ? lines.join('\n') : '(draft partially initialised)';
}

function summarizeArtifacts(state: AgentState): string {
  const arts = state.artifacts;
  const present = Object.keys(arts).filter((k) => arts[k as keyof typeof arts] != null);
  if (present.length === 0) return state.locale === 'zh' ? '（无产物）' : '(no artifacts)';
  return present
    .map((k) => {
      const env = arts[k as keyof typeof arts] as { status?: string; revision?: number } | undefined;
      return `- ${k}: status=${env?.status ?? '?'}, rev=${env?.revision ?? '?'}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SystemPromptContext {
  state: AgentState;
  skillManifests: SkillManifest[];
}

/**
 * Build the system prompt (and optional earlier messages) for the ReAct agent
 * `callModel` node.
 *
 * Returns a list of message-like objects suitable for prepending to the
 * conversation before invoking the LLM.
 */
export function buildSystemMessages(ctx: SystemPromptContext): BaseMessageLike[] {
  const { state, skillManifests } = ctx;
  const isZh = state.locale === 'zh';

  const skillList = skillManifests
    .map((s) => {
      const name = isZh ? s.name.zh : s.name.en;
      const desc = isZh ? s.description.zh : s.description.en;
      return `- ${s.id} (${name}): ${desc} [domain=${s.domain}, stages=${s.stages.join('/')}]`;
    })
    .join('\n');

  const systemContent = isZh
    ? buildZhPrompt(state, skillList)
    : buildEnPrompt(state, skillList);

  return [{ role: 'system' as const, content: systemContent }];
}

// ---------------------------------------------------------------------------
// Prompt builders (bilingual)
// ---------------------------------------------------------------------------

function buildZhPrompt(state: AgentState, skillList: string): string {
  return `你是 StructureClaw 结构工程 AI 助手。你具备以下能力：
1. 结构工程分析 — 识别结构类型、提取参数、构建模型、执行分析、规范校核、生成报告
2. 工作区操作 — 读取、修改、创建工作区目录下的文件（用于修复配置或代码）

## 可用技能

${skillList}

## 当前会话状态

### 草稿参数
${summarizeDraft(state)}

### 已有产物
${summarizeArtifacts(state)}

### 会话配置
- 分析类型: ${state.policy?.analysisType ?? '未设置'}
- 设计规范: ${state.policy?.designCode ?? '未设置'}
- 已选技能: ${state.selectedSkillIds.length > 0 ? state.selectedSkillIds.join(', ') : '无'}

## 行为规则

1. **推理优先**: 在调用工具前，先思考用户意图和当前状态
2. **逐步执行**: 每次调用一个工具，观察结果后再决定下一步
3. **错误恢复**: 如果工具返回错误，分析原因并尝试修复，而不是直接放弃
4. **安全边界**: 只能操作 ${state.workspaceRoot || '工作区目录'} 下的文件，绝对不能越界
5. **双语支持**: 用 ${localeLabel(state.locale)} 与用户交流
6. **主动提问**: 当关键参数缺失时，使用 ask_user_clarification 工具询问用户
7. **工具调用限制**: 每轮对话最多调用 15 次工具，避免无限循环`;
}

function buildEnPrompt(state: AgentState, skillList: string): string {
  return `You are the StructureClaw structural engineering AI assistant. Your capabilities:
1. Structural analysis — identify type, extract parameters, build model, run analysis, code-check, generate report
2. Workspace operations — read, modify, create files under the workspace directory (for fixing configs or code)

## Available Skills

${skillList}

## Current Session State

### Draft Parameters
${summarizeDraft(state)}

### Existing Artifacts
${summarizeArtifacts(state)}

### Session Config
- Analysis type: ${state.policy?.analysisType ?? 'not set'}
- Design code: ${state.policy?.designCode ?? 'not set'}
- Selected skills: ${state.selectedSkillIds.length > 0 ? state.selectedSkillIds.join(', ') : 'none'}

## Behaviour Rules

1. **Reason first**: Think about user intent and current state before calling a tool
2. **Step by step**: Call one tool at a time, observe the result, then decide the next step
3. **Error recovery**: If a tool returns an error, analyse the cause and try to fix it instead of giving up
4. **Safety boundary**: Only operate on files under ${state.workspaceRoot || 'the workspace directory'} — never go outside
5. **Bilingual**: Communicate in ${localeLabel(state.locale)}
6. **Ask when unclear**: Use the ask_user_clarification tool when critical parameters are missing
7. **Tool call limit**: At most 15 tool calls per conversation turn to avoid infinite loops`;
}
