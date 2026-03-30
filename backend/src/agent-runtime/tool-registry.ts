import type { SkillManifest, ToolManifest } from './types.js';

function localize(zh: string, en: string) {
  return { zh, en };
}

function titleize(value: string): string {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const BUILTIN_TOOL_MANIFESTS: ToolManifest[] = [
  {
    id: 'draft_model',
    source: 'builtin',
    enabledByDefault: false,
    category: 'modeling',
    displayName: localize('草拟结构模型', 'Draft Structural Model'),
    description: localize('从文本和补充参数生成或更新可计算结构模型草稿。', 'Generate or update a computable structural model draft from text and provided parameters.'),
    tags: ['draft', 'model', 'structure-type'],
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string' },
        conversationId: { type: 'string' },
        phase: { enum: ['interactive', 'execution'] },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        inferredType: { type: 'string' },
        missingFields: { type: 'array', items: { type: 'string' } },
        extractionMode: { enum: ['llm', 'rule-based'] },
        model: { type: 'object' },
      },
    },
    errorCodes: ['AGENT_MISSING_MODEL_INPUT'],
  },
  {
    id: 'convert_model',
    source: 'builtin',
    enabledByDefault: false,
    category: 'modeling',
    displayName: localize('转换结构模型', 'Convert Structural Model'),
    description: localize('在支持的结构协议格式之间转换模型。', 'Convert a structural model between supported protocol formats.'),
    tags: ['convert_model', 'model', 'protocol'],
    inputSchema: {
      type: 'object',
      required: ['model'],
      properties: {
        model: { type: 'object' },
        source_format: { type: 'string' },
        target_format: { type: 'string' },
        target_schema_version: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        sourceFormat: { type: 'string' },
        targetFormat: { type: 'string' },
        sourceSchemaVersion: { type: 'string' },
        targetSchemaVersion: { type: 'string' },
        model: { type: 'object' },
      },
    },
    errorCodes: ['UNSUPPORTED_SOURCE_FORMAT', 'UNSUPPORTED_TARGET_FORMAT', 'INVALID_STRUCTURE_MODEL'],
  },
  {
    id: 'validate_model',
    source: 'builtin',
    enabledByDefault: false,
    category: 'modeling',
    displayName: localize('校验结构模型', 'Validate Structural Model'),
    description: localize('校验结构模型字段合法性与引用完整性。', 'Validate the structural model fields and reference integrity.'),
    tags: ['validate_model', 'model'],
    inputSchema: {
      type: 'object',
      required: ['model'],
      properties: {
        model: { type: 'object' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        schemaVersion: { type: 'string' },
        stats: { type: 'object' },
      },
    },
    errorCodes: ['INVALID_STRUCTURE_MODEL'],
  },
  {
    id: 'run_analysis',
    source: 'builtin',
    enabledByDefault: false,
    category: 'analysis',
    displayName: localize('执行结构分析', 'Run Structural Analysis'),
    description: localize('执行结构分析（static/dynamic/seismic/nonlinear）。', 'Execute structural analysis (static, dynamic, seismic, or nonlinear).'),
    tags: ['analysis', 'engine'],
    inputSchema: {
      type: 'object',
      required: ['type', 'model', 'parameters'],
      properties: {
        type: { enum: ['static', 'dynamic', 'seismic', 'nonlinear'] },
        model: { type: 'object' },
        parameters: { type: 'object' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        schema_version: { type: 'string' },
        analysis_type: { type: 'string' },
        success: { type: 'boolean' },
        error_code: { type: ['string', 'null'] },
        message: { type: 'string' },
        data: { type: 'object' },
        meta: { type: 'object' },
      },
    },
    errorCodes: ['INVALID_ANALYSIS_TYPE', 'ANALYSIS_EXECUTION_FAILED'],
  },
  {
    id: 'run_code_check',
    source: 'builtin',
    enabledByDefault: false,
    category: 'code-check',
    displayName: localize('执行规范校核', 'Run Code Check'),
    description: localize('结构规范校核。', 'Run structural code checks.'),
    tags: ['run_code_check', 'design-code'],
    inputSchema: {
      type: 'object',
      required: ['code', 'elements'],
      properties: {
        modelId: { type: 'string' },
        code: { type: 'string' },
        elements: { type: 'array', items: { type: 'string' } },
      },
    },
    outputSchema: {
      type: 'object',
    },
    errorCodes: ['CODE_CHECK_EXECUTION_FAILED'],
  },
  {
    id: 'generate_report',
    source: 'builtin',
    enabledByDefault: false,
    category: 'report',
    displayName: localize('生成报告', 'Generate Report'),
    description: localize('将模型、分析与规范校核结果汇总为可读报告。', 'Assemble inputs, analysis, and run_code_check outputs into a readable report.'),
    tags: ['generate_report', 'artifact'],
    inputSchema: {
      type: 'object',
      required: ['message', 'analysis'],
      properties: {
        message: { type: 'string' },
        analysis: { type: 'object' },
        codeCheck: { type: 'object' },
        format: { enum: ['json', 'markdown', 'both'] },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        json: { type: 'object' },
        markdown: { type: 'string' },
      },
    },
    errorCodes: [],
  },
];

export interface ResolvedTooling {
  tools: ToolManifest[];
  enabledToolIdsBySkill: Record<string, string[]>;
  providedToolIdsBySkill: Record<string, string[]>;
  skillIdsByToolId: Record<string, string[]>;
}

export function listBuiltinToolManifests(): ToolManifest[] {
  return BUILTIN_TOOL_MANIFESTS.map((tool) => ({ ...tool }));
}

function inferEnabledToolsFromManifest(manifest: SkillManifest): string[] {
  if (Array.isArray(manifest.enabledTools) && manifest.enabledTools.length > 0) {
    return [...manifest.enabledTools];
  }

  const enabled = new Set<string>();
  if (manifest.domain === 'structure-type') {
    enabled.add('draft_model');
    enabled.add('validate_model');
    enabled.add('run_analysis');
  }
  if (manifest.domain === 'analysis-strategy' || manifest.capabilities.includes('analyze')) {
    enabled.add('run_analysis');
  }
  if (manifest.domain === 'code-check' || manifest.capabilities.includes('code-check')) {
    enabled.add('run_code_check');
  }
  if (
    manifest.domain === 'report-export'
    || manifest.capabilities.includes('report-export')
    || manifest.capabilities.includes('report-narrative')
  ) {
    enabled.add('generate_report');
  }
  if (manifest.domain === 'generic-fallback') {
    enabled.add('draft_model');
    enabled.add('validate_model');
    enabled.add('run_analysis');
    enabled.add('generate_report');
  }
  return [...enabled];
}

function createSkillProvidedTool(toolId: string, skillId: string): ToolManifest {
  return {
    id: toolId,
    source: 'skill',
    enabledByDefault: false,
    displayName: {
      zh: titleize(toolId),
      en: titleize(toolId),
    },
    description: {
      zh: `${skillId} skill 提供的扩展 tool。`,
      en: `Extension tool provided by the ${skillId} skill.`,
    },
    providedBySkillId: skillId,
    requiresSkills: [skillId],
    tags: ['skill-provided'],
    errorCodes: [],
  };
}

function resolveRelevantSkillManifests(manifests: SkillManifest[], skillIds?: string[]): SkillManifest[] {
  if (skillIds === undefined) {
    return manifests.filter((manifest) => manifest.autoLoadByDefault);
  }
  if (skillIds.length === 0) {
    return [];
  }
  const selected = new Set(skillIds);
  return manifests.filter((manifest) => selected.has(manifest.id));
}

export function resolveToolingForSkillManifests(manifests: SkillManifest[], skillIds?: string[]): ResolvedTooling {
  const relevantManifests = resolveRelevantSkillManifests(manifests, skillIds);
  const builtinById = new Map(BUILTIN_TOOL_MANIFESTS.map((tool) => [tool.id, tool]));
  const toolMap = new Map<string, ToolManifest>();
  const enabledToolIdsBySkill: Record<string, string[]> = {};
  const providedToolIdsBySkill: Record<string, string[]> = {};
  const skillIdsByToolId = new Map<string, Set<string>>();

  for (const manifest of relevantManifests) {
    const enabledToolIds = Array.from(new Set(inferEnabledToolsFromManifest(manifest)));
    const providedToolIds = Array.isArray(manifest.providedTools)
      ? Array.from(new Set(manifest.providedTools))
      : [];

    enabledToolIdsBySkill[manifest.id] = enabledToolIds;
    providedToolIdsBySkill[manifest.id] = providedToolIds;

    for (const toolId of [...enabledToolIds, ...providedToolIds]) {
      if (!skillIdsByToolId.has(toolId)) {
        skillIdsByToolId.set(toolId, new Set());
      }
      skillIdsByToolId.get(toolId)!.add(manifest.id);
    }

    for (const toolId of enabledToolIds) {
      const builtin = builtinById.get(toolId);
      toolMap.set(toolId, builtin ? { ...builtin } : createSkillProvidedTool(toolId, manifest.id));
    }

    for (const toolId of providedToolIds) {
      const builtin = builtinById.get(toolId);
      toolMap.set(toolId, builtin
        ? {
          ...builtin,
          providedBySkillId: builtin.providedBySkillId ?? manifest.id,
          requiresSkills: Array.from(new Set([...(builtin.requiresSkills || []), manifest.id])),
        }
        : createSkillProvidedTool(toolId, manifest.id));
    }
  }

  return {
    tools: Array.from(toolMap.values()).sort((left, right) => left.id.localeCompare(right.id)),
    enabledToolIdsBySkill,
    providedToolIdsBySkill,
    skillIdsByToolId: Array.from(skillIdsByToolId.entries()).reduce<Record<string, string[]>>((acc, [toolId, skillOwners]) => {
      acc[toolId] = Array.from(skillOwners).sort();
      return acc;
    }, {}),
  };
}
