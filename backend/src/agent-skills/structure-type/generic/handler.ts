import { mapMissingFieldLabels } from '../../../agent-runtime/draft-guidance.js';
import {
  mergeDraftState,
  normalizeInferredType,
  normalizeLoadPosition,
  normalizeLoadPositionM,
  normalizeLoadType,
  normalizeNumber,
  normalizeSupportType,
} from '../../../agent-runtime/fallback.js';
import { buildStructuralTypeMatch } from '../../../agent-runtime/plugin-helpers.js';
import type {
  DraftExtraction,
  DraftState,
  InferredModelType,
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function inferTypeFromText(value: unknown): InferredModelType | undefined {
  const text = stringValue(value)?.toLowerCase();
  if (!text) return undefined;
  if (text.includes('beam') || text.includes('梁')) return 'beam';
  if (text.includes('truss') || text.includes('桁架')) return 'truss';
  if (text.includes('portal') || text.includes('门式') || text.includes('刚架')) return 'portal-frame';
  if (text.includes('frame') || text.includes('框架')) return 'frame';
  return normalizeInferredType(text);
}

function inferSupportTypeFromText(value: unknown): DraftExtraction['supportType'] {
  const normalized = normalizeSupportType(value);
  if (normalized) return normalized;
  const text = stringValue(value)?.toLowerCase();
  if (!text) return undefined;
  if (text.includes('simply') || text.includes('simple') || text.includes('简支')) return 'simply-supported';
  if (text.includes('cantilever') || text.includes('悬臂')) return 'cantilever';
  if (text.includes('fixed-fixed') || text.includes('两端固')) return 'fixed-fixed';
  if (text.includes('fixed-pinned') || text.includes('固铰')) return 'fixed-pinned';
  return undefined;
}

function inferLoadTypeFromPatch(patch: Record<string, unknown>): DraftExtraction['loadType'] {
  const normalized = normalizeLoadType(patch.loadType ?? patch.load_type);
  if (normalized) return normalized;
  if (Array.isArray(patch.pointLoads) || Array.isArray(patch.point_loads)) return 'point';
  if (Array.isArray(patch.distributedLoads) || Array.isArray(patch.distributed_loads)) return 'distributed';
  return undefined;
}

function normalizeGenericDraftPatch(
  message: string,
  llmDraftPatch: Record<string, unknown> | null | undefined,
): DraftExtraction {
  const source = llmDraftPatch ?? {};
  const pointLoad = firstRecord(source.pointLoads ?? source.point_loads);
  const distributedLoad = firstRecord(source.distributedLoads ?? source.distributed_loads);
  const span = normalizeNumber(source.lengthM ?? source.spanLengthM ?? source.span ?? source.length);
  const loadValue = normalizeNumber(
    source.loadKN
    ?? source.load
    ?? source.loadValue
    ?? pointLoad?.force
    ?? pointLoad?.value
    ?? pointLoad?.magnitude
    ?? distributedLoad?.force
    ?? distributedLoad?.value,
  );
  const loadPositionM = normalizeLoadPositionM(
    source.loadPositionM
    ?? source.position
    ?? pointLoad?.position
    ?? pointLoad?.positionM,
  );
  const loadType = inferLoadTypeFromPatch(source);
  const explicitType = normalizeInferredType(source.inferredType);
  const inferredType =
    (explicitType && explicitType !== 'unknown' ? explicitType : undefined)
    ?? inferTypeFromText(source.componentType)
    ?? inferTypeFromText(source.structureType)
    ?? inferTypeFromText(source.structuralType)
    ?? inferTypeFromText(source.type)
    ?? inferTypeFromText(message);

  const patch: DraftExtraction = {};
  if (inferredType) patch.inferredType = inferredType;
  if (span !== undefined) patch.lengthM = span;
  if (loadValue !== undefined) patch.loadKN = loadValue;
  if (loadType) patch.loadType = loadType;
  const supportType = inferSupportTypeFromText(
    source.supportType
    ?? source.supportCondition
    ?? source.support_condition
    ?? source.boundaryCondition
    ?? message,
  );
  if (supportType) patch.supportType = supportType;
  const loadPosition = normalizeLoadPosition(source.loadPosition ?? source.load_position);
  if (loadPosition) {
    patch.loadPosition = loadPosition;
  } else if (loadType === 'point' && span !== undefined && loadPositionM !== undefined && Math.abs(loadPositionM - span / 2) < 1e-6) {
    patch.loadPosition = 'midspan';
  } else if (loadType === 'point' && (message.includes('中间') || message.includes('跨中'))) {
    patch.loadPosition = 'midspan';
  } else if (loadType === 'distributed') {
    patch.loadPosition = 'full-span';
  }
  if (loadPositionM !== undefined) patch.loadPositionM = loadPositionM;

  if (Object.keys(source).length > 0) {
    patch.skillState = {
      genericDraft: source,
    };
  }
  return patch;
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

  extractDraft({ message, llmDraftPatch }) {
    return normalizeGenericDraftPatch(message, llmDraftPatch);
  },

  mergeState(existing, patch) {
    const merged = mergeDraftState(existing, patch);
    const inferredType = merged.inferredType;
    return {
      ...merged,
      inferredType,
      skillId: 'generic',
      structuralTypeKey: (inferredType === 'unknown' ? 'unknown' : inferredType) as DraftState['structuralTypeKey'],
      supportLevel: patch.supportLevel ?? existing?.supportLevel ?? 'fallback',
      supportNote: patch.supportNote ?? existing?.supportNote,
      skillState: {
        ...(existing?.skillState ?? {}),
        ...(patch.skillState ?? {}),
      },
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
