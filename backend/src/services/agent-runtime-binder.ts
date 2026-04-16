import type { DraftState, StructuralTypeMatch } from '../agent-runtime/index.js';
import type { ProviderBindingState, SchedulerStep, SkillManifest, ToolManifest } from '../agent-runtime/types.js';

export type RuntimeBinderActiveToolSet = Set<string>;

type RuntimeBinderAnalysisType = 'static' | 'dynamic' | 'seismic' | 'nonlinear';

export interface RuntimeBinderContext {
  analysisType?: RuntimeBinderAnalysisType;
  engineId?: string;
  autoAnalyze?: boolean;
  autoCodeCheck?: boolean;
  designCode?: string;
  includeReport?: boolean;
  enabledToolIds?: string[];
  disabledToolIds?: string[];
}

export interface RuntimeBinderSession {
  structuralTypeMatch?: Pick<StructuralTypeMatch, 'skillId' | 'key'>;
  draft?: Pick<DraftState, 'skillId' | 'structuralTypeKey' | 'inferredType'>;
  latestModel?: Record<string, unknown>;
  resolved?: {
    analysisType?: RuntimeBinderAnalysisType;
    designCode?: string;
    autoCodeCheck?: boolean;
    includeReport?: boolean;
  };
  updatedAt: number;
}

interface RuntimeBindingSkillRuntimeLike {
  listSkillManifests(): Promise<SkillManifest[]>;
  resolvePreferredAnalysisSkill(options?: {
    analysisType?: RuntimeBinderAnalysisType;
    engineId?: string;
    skillIds?: string[];
    supportedModelFamilies?: string[];
  }): Pick<SkillManifest, 'id'> | undefined;
  resolveCodeCheckDesignCodeFromSkillIds(skillIds?: string[]): string | undefined;
  resolveCodeCheckSkillId(designCode: string | undefined): string | undefined;
  resolveSkillTooling(skillIds?: string[]): Promise<{
    tools: ToolManifest[];
    skillIdsByToolId: Record<string, string[]>;
  }>;
  listBuiltinToolManifests(): ToolManifest[];
}

interface RuntimeBindingPolicyLike {
  inferExecutionIntent(message: string): boolean;
  inferProceedIntent(message: string): boolean;
  inferAnalysisType?(message: string): RuntimeBinderAnalysisType;
  inferCodeCheckIntent?(message: string): boolean;
  inferReportIntent?(message: string): boolean | undefined;
  inferDesignCode?(message: string): string | undefined;
}

export class AgentRuntimeBinder {
  constructor(
    private readonly skillRuntime: RuntimeBindingSkillRuntimeLike,
    private readonly policy: RuntimeBindingPolicyLike,
    private readonly foundationToolIds: readonly string[] = ['convert_model'],
  ) {}

  normalizeSkillIds(skillIds?: string[]): string[] {
    return Array.isArray(skillIds)
      ? skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
  }

  async resolveActiveDomainSkillIds(args: {
    selectedSkillIds?: string[];
    providerBindings?: ProviderBindingState;
    workingSession: RuntimeBinderSession;
    modelInput?: Record<string, unknown>;
    message: string;
    context?: RuntimeBinderContext;
    hasEmptySkillSelection?: (skillIds?: string[]) => boolean;
  }): Promise<string[] | undefined> {
    const selectedSkillIds = this.normalizeSkillIds(args.selectedSkillIds);
    const activatedSkillIds = new Set<string>(selectedSkillIds);

    // Provider-first path: when caller explicitly passes providerBindings,
    // only activate selected skills + bound providers (Phase 4 scheduler path).
    // When providerBindings is NOT in args, fall through to legacy auto-activation.
    if ('providerBindings' in args) {
      if (args.providerBindings?.analysisProviderSkillId) {
        activatedSkillIds.add(args.providerBindings.analysisProviderSkillId);
      }
      if (args.providerBindings?.codeCheckProviderSkillId) {
        activatedSkillIds.add(args.providerBindings.codeCheckProviderSkillId);
      }
      return Array.from(activatedSkillIds).sort();
    }

    // Legacy auto-activation path (current agent.ts does not pass providerBindings).
    // Phase 4 will switch to the provider-first path above.
    if (args.hasEmptySkillSelection?.(args.selectedSkillIds)) {
      return [];
    }

    const manifests = await this.skillRuntime.listSkillManifests();
    const selectedSkillSet = new Set(selectedSkillIds);
    const structuralSkillId = args.workingSession.structuralTypeMatch?.skillId
      || args.workingSession.draft?.skillId
      || manifests.find((manifest) => manifest.domain === 'structure-type' && selectedSkillSet.has(manifest.id))?.id;
    if (structuralSkillId) {
      activatedSkillIds.add(structuralSkillId);
    }

    const hasStructuralContext = Boolean(structuralSkillId || args.workingSession.draft || args.modelInput || args.workingSession.latestModel);
    const hasExecutionIntent = this.policy.inferExecutionIntent(args.message) || this.policy.inferProceedIntent(args.message);
    const analysisType = args.workingSession.resolved?.analysisType
      || args.context?.analysisType
      || this.policy.inferAnalysisType?.(args.message)
      || 'static';
    const explicitDesignCode = args.workingSession.resolved?.designCode
      || args.context?.designCode
      || this.policy.inferDesignCode?.(args.message);
    const designCode = explicitDesignCode || this.skillRuntime.resolveCodeCheckDesignCodeFromSkillIds(selectedSkillIds);
    const codeCheckIntent = this.policy.inferCodeCheckIntent?.(args.message) ?? false;
    const reportIntent = this.policy.inferReportIntent?.(args.message);

    const shouldActivateValidation = hasStructuralContext
      || hasExecutionIntent
      || codeCheckIntent
      || reportIntent === true;
    if (shouldActivateValidation) {
      activatedSkillIds.add('validation-structure-model');
    }

    if (hasStructuralContext || hasExecutionIntent || args.context?.autoAnalyze === true) {
      const preferredAnalysisSkill = this.skillRuntime.resolvePreferredAnalysisSkill({
        analysisType,
        engineId: args.context?.engineId,
        skillIds: selectedSkillIds,
        supportedModelFamilies: this.resolvePreferredAnalysisModelFamilies({
          workingSession: args.workingSession,
          modelInput: args.modelInput,
        }),
      });
      if (preferredAnalysisSkill) {
        activatedSkillIds.add(preferredAnalysisSkill.id);
      }
    }

    const shouldActivateCodeCheck = Boolean(designCode) && (
      args.workingSession.resolved?.autoCodeCheck
      ?? args.context?.autoCodeCheck
      ?? codeCheckIntent
      ?? true
    );
    if (shouldActivateCodeCheck) {
      const codeCheckSkillId = this.skillRuntime.resolveCodeCheckSkillId(designCode);
      if (codeCheckSkillId) {
        activatedSkillIds.add(codeCheckSkillId);
      }
    }

    const shouldActivateReport = (
      args.workingSession.resolved?.includeReport
      ?? args.context?.includeReport
      ?? true
    ) && (hasStructuralContext || hasExecutionIntent || reportIntent === true);
    if (shouldActivateReport) {
      activatedSkillIds.add('report-export-builtin');
    }

    if (activatedSkillIds.size === 0) {
      return args.selectedSkillIds === undefined ? undefined : [];
    }

    return Array.from(activatedSkillIds).sort();
  }

  async resolveProviderBindingRequirements(args: {
    selectedSkillIds?: string[];
    requiredSlots: Array<'analysisProvider' | 'codeCheckProvider'>;
    bindings?: ProviderBindingState;
    modelFamily?: string;
    analysisType?: string;
    designCode?: string;
  }): Promise<{ blockedReason?: string }> {
    const manifests = await this.skillRuntime.listSkillManifests();
    const selectedSkillSet = new Set(this.normalizeSkillIds(args.selectedSkillIds));

    for (const slot of args.requiredSlots) {
      const candidates = manifests.filter((manifest) => {
        const rc = manifest.runtimeContract;
        return selectedSkillSet.has(manifest.id)
          && rc?.role === 'provider'
          && (rc as { providerSlot?: string }).providerSlot === slot;
      });
      const boundSkillId = slot === 'analysisProvider'
        ? args.bindings?.analysisProviderSkillId
        : args.bindings?.codeCheckProviderSkillId;
      if (candidates.length > 1 && !boundSkillId) {
        return { blockedReason: `${slot} binding required because multiple provider candidates are selected` };
      }

      const boundManifest = boundSkillId
        ? manifests.find((m) => m.id === boundSkillId)
        : candidates[0];
      if (boundManifest?.runtimeContract && args.modelFamily) {
        const contract = boundManifest.runtimeContract as any;
        if (contract.supportedModelFamilies && !contract.supportedModelFamilies.includes(args.modelFamily)) {
          return { blockedReason: 'provider incompatible' };
        }
      }
    }

    return {};
  }

  assertStepAuthorized(args: {
    step: SchedulerStep;
    selectedSkillIds?: string[];
    bindings?: ProviderBindingState;
  }): void {
    // Provider-slot binding checks (skip for reuse — no execution needed)
    if (args.step.mode !== 'reuse') {
      if (args.step.role === 'provider' && args.step.provides === 'analysisRaw' && !args.bindings?.analysisProviderSkillId) {
        throw new Error('analysisProvider binding required');
      }
      if (args.step.role === 'provider' && args.step.provides === 'codeCheckResult' && !args.bindings?.codeCheckProviderSkillId) {
        throw new Error('codeCheckProvider binding required');
      }
    }

    // Skill authorization: when a step declares a skillId, it must be in the selected set
    if (args.step.skillId && args.selectedSkillIds && args.selectedSkillIds.length > 0
      && !args.selectedSkillIds.includes(args.step.skillId)) {
      throw new Error('skill not in selected skill set');
    }
  }

  async resolveAvailableTooling(
    selectedSkillIds?: string[],
    activeSkillIds?: string[],
  ): Promise<{ tools: ToolManifest[]; skillIdsByToolId: Record<string, string[]> }> {
    const toolMap = new Map<string, ToolManifest>();
    const ownerMap = new Map<string, Set<string>>();
    const keyCache = new Set<string>();
    const toolingInputs: Array<string[] | undefined> = [selectedSkillIds, activeSkillIds];

    for (const skillIds of toolingInputs) {
      const cacheKey = skillIds === undefined ? '__AUTO__' : JSON.stringify(this.normalizeSkillIds(skillIds));
      if (keyCache.has(cacheKey)) {
        continue;
      }
      keyCache.add(cacheKey);
      const tooling = await this.skillRuntime.resolveSkillTooling(skillIds);
      for (const tool of tooling.tools) {
        if (!toolMap.has(tool.id)) {
          toolMap.set(tool.id, tool);
        }
      }
      for (const [toolId, skillOwners] of Object.entries(tooling.skillIdsByToolId)) {
        if (!ownerMap.has(toolId)) {
          ownerMap.set(toolId, new Set());
        }
        for (const skillId of skillOwners) {
          ownerMap.get(toolId)!.add(skillId);
        }
      }
    }

    return {
      tools: Array.from(toolMap.values()).sort((left, right) => left.id.localeCompare(right.id)),
      skillIdsByToolId: Array.from(ownerMap.entries()).reduce<Record<string, string[]>>((acc, [toolId, skillOwners]) => {
        acc[toolId] = Array.from(skillOwners).sort();
        return acc;
      }, {}),
    };
  }

  async resolveActiveToolIds(
    selectedSkillIds?: string[],
    activeSkillIds?: string[],
    options?: { enabledToolIds?: string[]; disabledToolIds?: string[] },
  ): Promise<RuntimeBinderActiveToolSet> {
    const builtinCatalog = new Set(this.skillRuntime.listBuiltinToolManifests().map((tool) => tool.id));
    const active = new Set<string>();

    for (const toolId of this.foundationToolIds) {
      if (builtinCatalog.has(toolId)) {
        active.add(toolId);
      }
    }

    const tooling = await this.resolveAvailableTooling(selectedSkillIds, activeSkillIds);
    for (const tool of tooling.tools) {
      active.add(tool.id);
    }

    return this.applyToolSelection(active, options);
  }

  async resolveSelectedToolManifest(toolId: string, skillIds?: string[]): Promise<ToolManifest | undefined> {
    const builtin = this.skillRuntime.listBuiltinToolManifests().find((tool) => tool.id === toolId);
    if (builtin) {
      return builtin;
    }
    const tooling = await this.resolveAvailableTooling(undefined, skillIds);
    return tooling.tools.find((tool) => tool.id === toolId);
  }

  hasActiveTool(activeToolIds: RuntimeBinderActiveToolSet | undefined, toolId: string): boolean {
    return !activeToolIds || activeToolIds.has(toolId);
  }

  buildMissingToolRequirements(args: {
    manifest: ToolManifest;
    skillIds?: string[];
    activeToolIds?: RuntimeBinderActiveToolSet;
  }): { missingSkills: string[]; missingTools: string[] } {
    const selectedSkillIds = new Set(Array.isArray(args.skillIds) ? args.skillIds : []);
    const missingSkills = Array.isArray(args.manifest.requiresSkills)
      ? args.manifest.requiresSkills.filter((skillId) => !selectedSkillIds.has(skillId))
      : [];
    const missingTools = Array.isArray(args.manifest.requiresTools)
      ? args.manifest.requiresTools.filter((toolId) => !this.hasActiveTool(args.activeToolIds, toolId))
      : [];
    return { missingSkills, missingTools };
  }

  private applyToolSelection(
    active: Set<string>,
    options?: { enabledToolIds?: string[]; disabledToolIds?: string[] },
  ): RuntimeBinderActiveToolSet {
    const enabledToolIds = Array.isArray(options?.enabledToolIds)
      ? options.enabledToolIds
        .map((toolId) => (typeof toolId === 'string' ? toolId.trim() : ''))
        .filter((toolId): toolId is string => toolId.length > 0)
      : undefined;
    const disabledToolIds = Array.isArray(options?.disabledToolIds)
      ? options.disabledToolIds
        .map((toolId) => (typeof toolId === 'string' ? toolId.trim() : ''))
        .filter((toolId): toolId is string => toolId.length > 0)
      : [];

    const selected = enabledToolIds ? new Set(enabledToolIds.filter((toolId) => active.has(toolId))) : new Set(active);
    for (const toolId of disabledToolIds) {
      selected.delete(toolId);
    }
    return selected;
  }

  resolvePreferredAnalysisModelFamilies(args: {
    workingSession: RuntimeBinderSession;
    modelInput?: Record<string, unknown>;
  }): string[] {
    const structuralType = args.workingSession.structuralTypeMatch?.key
      || args.workingSession.draft?.structuralTypeKey
      || args.workingSession.draft?.inferredType;
    if (structuralType === 'truss') {
      return ['truss', 'generic'];
    }
    if (
      structuralType === 'beam'
      || structuralType === 'frame'
      || structuralType === 'portal-frame'
      || structuralType === 'double-span-beam'
    ) {
      return ['frame', 'generic'];
    }

    const modelElements = args.modelInput?.elements;
    if (Array.isArray(modelElements) && modelElements.some((element) => {
      if (!element || typeof element !== 'object') {
        return false;
      }
      return (element as Record<string, unknown>).type === 'truss';
    })) {
      return ['truss', 'generic'];
    }

    return ['generic'];
  }
}

export default AgentRuntimeBinder;
