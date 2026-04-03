import { mapMissingFieldLabels } from '../../../agent-runtime/draft-guidance.js';
import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import type {
  DraftExtraction,
  DraftState,
  SkillHandler,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';

function hasStructuralIntent(text: string): boolean {
  if (/(beam|truss|frame|portal|girder|cantilever|support|span|bay|story|load|model|analysis|design|member|node|element|structure)/i.test(text)) {
    return true;
  }
  if (/(梁|桁架|框架|刚架|门架|跨度|跨|层|荷载|支座|结构|模型|分析|设计|构件|节点)/.test(text)) {
    return true;
  }
  return /(\d+(?:\.\d+)?)\s*(m|米|kn|kN|千牛)/.test(text);
}

function buildGenericReportNarrative(input: SkillReportNarrativeInput): string {
  const metricCount = Object.keys(input.keyMetrics || {}).length;
  if (input.locale === 'zh') {
    const lines = [
      '已完成通用结构流程的分析汇总。',
      `分析类型：${input.analysisType}。`,
      `执行状态：${input.analysisSuccess ? '成功' : '失败'}。`,
      input.summary ? `结果摘要：${input.summary}` : '结果摘要：请结合结构化结果查看详细信息。',
    ];
    if (metricCount > 0) {
      lines.push(`已提取 ${metricCount} 项关键指标，请结合结构化输出核对。`);
    }
    if (input.codeCheckText?.trim()) {
      lines.push('已包含规范校核文本结果。');
    }
    return lines.join('\n');
  }

  const lines = [
    'The generic structural workflow summary is complete.',
    `Analysis type: ${input.analysisType}.`,
    `Execution status: ${input.analysisSuccess ? 'success' : 'failed'}.`,
    input.summary
      ? `Summary: ${input.summary}`
      : 'Summary: review the structured outputs for detailed engineering values.',
  ];
  if (metricCount > 0) {
    lines.push(`${metricCount} key metric entries were extracted from the analysis output.`);
  }
  if (input.codeCheckText?.trim()) {
    lines.push('Code-check text output is included in this report context.');
  }
  return lines.join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale, currentState }) {
    if (currentState?.skillId === 'generic') {
      return buildStructuralTypeMatch(
        currentState.structuralTypeKey ?? 'unknown',
        currentState.inferredType,
        'generic',
        currentState.supportLevel ?? 'fallback',
        locale,
        {
          zh: '继续使用通用结构类型 skill 处理当前对话。',
          en: 'Continue using the generic structure-type skill for the current conversation.',
        },
      );
    }

    if (!hasStructuralIntent(message)) {
      return null;
    }

    return buildStructuralTypeMatch('unknown', 'unknown', 'generic', 'fallback', locale, {
      zh: '已切换到通用结构类型 skill，先接住当前问题并继续补参。',
      en: 'Switched to the generic structure-type skill to catch the request and continue clarification.',
    });
  },

  parseProvidedValues(values) {
    const patch: DraftExtraction = {};
    if (values && typeof values === 'object') {
      const v = values as Record<string, unknown>;
      if (typeof v.inferredType === 'string') {
        patch.inferredType = v.inferredType as DraftExtraction['inferredType'];
      }
    }
    return patch;
  },

  extractDraft({ llmDraftPatch }) {
    const patch: DraftExtraction = {};
    if (llmDraftPatch && typeof llmDraftPatch === 'object') {
      if (typeof llmDraftPatch.inferredType === 'string') {
        patch.inferredType = llmDraftPatch.inferredType as DraftExtraction['inferredType'];
      }
    }
    return patch;
  },

  mergeState(existing, patch) {
    const inferredType = patch.inferredType && patch.inferredType !== 'unknown'
      ? patch.inferredType
      : (existing?.inferredType ?? 'unknown');
    return {
      inferredType,
      skillId: 'generic',
      structuralTypeKey: (inferredType === 'unknown' ? 'unknown' : inferredType) as DraftState['structuralTypeKey'],
      supportLevel: patch.supportLevel ?? existing?.supportLevel ?? 'fallback',
      supportNote: patch.supportNote ?? existing?.supportNote,
      updatedAt: Date.now(),
    };
  },

  computeMissing(state) {
    if (state.inferredType === 'unknown') {
      return { critical: ['inferredType'], optional: [] };
    }
    return { critical: [], optional: [] };
  },

  mapLabels(keys, locale) {
    return mapMissingFieldLabels(keys, locale);
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    if (state.inferredType === 'unknown') {
      return keys.map((paramKey) => ({
        paramKey,
        label: locale === 'zh' ? '结构体系' : 'Structural system',
        question: locale === 'zh'
          ? '请先描述结构体系、构件连接关系和主要荷载；如果你已经有可计算结构模型，也可以直接贴 JSON。'
          : 'Please first describe the structural system, member connectivity, and main loads. If you already have a computable structural model, you can paste the JSON directly.',
        required: true,
        critical: criticalMissing.includes(paramKey),
      }));
    }
    return [];
  },

  buildDefaultProposals() {
    return [];
  },

  buildReportNarrative(input: SkillReportNarrativeInput) {
    return buildGenericReportNarrative(input);
  },

  buildModel() {
    return undefined;
  },

  resolveStage(_missingKeys, state) {
    if (state.inferredType === 'unknown') {
      return 'intent';
    }
    return 'model';
  },
};

export default handler;
