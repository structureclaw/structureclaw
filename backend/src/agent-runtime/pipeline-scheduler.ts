import type {
  ArtifactKind,
  ArtifactEnvelope,
  ArtifactRef,
  ProjectArtifactKind,
  SchedulerTool,
  SchedulerStep,
  SchedulerInput,
  SchedulerPlan,
  SkillRole,
  ConsumerRuntimeContract,
} from './types.js';
import { canReuseArtifact, computeDependencyFingerprint, computeDraftStateContentHash } from './artifact-helpers.js';

// --- Tool-to-binding-key mapping ---

const TOOL_BINDING_KEY: Record<string, keyof import('./types.js').ProviderBindingState | 'structural'> = {
  draft_model: 'structural',
  update_model: 'structural',
  convert_model: 'structural',
  validate_model: 'validationSkillId',
  postprocess_result: 'postprocessSkillId',
  generate_report: 'reportSkillId',
  generate_drawing: 'drawingSkillId',
};

// --- Controlled artifact graph ---

interface GraphNode {
  dependsOn: ArtifactKind[];
  providerSlot?: 'analysisProvider' | 'codeCheckProvider';
  defaultTool: SchedulerTool;
  defaultRole: SkillRole;
}

const CONTROLLED_ARTIFACT_GRAPH: Record<ProjectArtifactKind, GraphNode> = {
  designBasis: { dependsOn: [], defaultTool: 'update_model', defaultRole: 'entry' },
  normalizedModel: { dependsOn: ['designBasis'], defaultTool: 'update_model', defaultRole: 'enricher' },
  analysisModel: { dependsOn: ['designBasis', 'normalizedModel'], defaultTool: 'convert_model', defaultRole: 'transformer' },
  analysisRaw: { dependsOn: ['analysisModel'], providerSlot: 'analysisProvider', defaultTool: 'run_analysis', defaultRole: 'provider' },
  postprocessedResult: { dependsOn: ['analysisRaw'], defaultTool: 'postprocess_result', defaultRole: 'transformer' },
  codeCheckResult: { dependsOn: ['designBasis', 'normalizedModel', 'postprocessedResult'], providerSlot: 'codeCheckProvider', defaultTool: 'run_code_check', defaultRole: 'provider' },
  drawingArtifact: { dependsOn: ['designBasis', 'normalizedModel'], defaultTool: 'generate_drawing', defaultRole: 'consumer' },
  reportArtifact: { dependsOn: ['designBasis', 'normalizedModel'], defaultTool: 'generate_report', defaultRole: 'consumer' },
};

// Consumer artifacts that support required/optional consumes
const CONSUMER_ARTIFACT_KINDS = new Set<ArtifactKind>(['drawingArtifact', 'reportArtifact']);

function artifactToRef(env: ArtifactEnvelope): ArtifactRef {
  return { kind: env.kind, artifactId: env.artifactId, revision: env.revision };
}

export interface SchedulerPlanInput extends SchedulerInput {
  consumerContracts?: ConsumerRuntimeContract[];
  enricherContracts?: Array<{ skillId: string; priority: number }>;
}

export class PipelineScheduler {
  plan(input: SchedulerPlanInput): SchedulerPlan {
    if (input.targetArtifact === 'chatReply') {
      return { targetArtifact: 'chatReply', requiredSteps: [] };
    }

    if (input.targetArtifact === 'draftState') {
      return { targetArtifact: 'draftState', requiredSteps: [] };
    }

    const target = input.targetArtifact as ProjectArtifactKind;

    if (!CONTROLLED_ARTIFACT_GRAPH[target] && !CONSUMER_ARTIFACT_KINDS.has(target)) {
      return {
        targetArtifact: input.targetArtifact,
        requiredSteps: [],
        blockedReason: `unknown target artifact: ${input.targetArtifact}`,
      };
    }

    if (!this.hasReadyArtifact('designBasis', input.projectArtifacts)) {
      return {
        targetArtifact: target,
        requiredSteps: [],
        blockedReason: 'designBasis incomplete',
      };
    }

    const plannedSet = new Set<ProjectArtifactKind>();

    if (CONSUMER_ARTIFACT_KINDS.has(target)) {
      return this.planConsumerPath(target, input, new Set(), new Set(), plannedSet);
    }

    return this.planDependencyPath(target, input, new Set(), new Set(), plannedSet);
  }

  private planConsumerPath(
    target: ArtifactKind,
    input: SchedulerPlanInput,
    visited: Set<ProjectArtifactKind>,
    rebuiltSet: Set<ProjectArtifactKind>,
    plannedSet: Set<ProjectArtifactKind>,
  ): SchedulerPlan {
    const contract = input.consumerContracts?.find(
      (c) => c.targetArtifact === target,
    );

    const requiredKinds = contract?.requiredConsumes ?? CONTROLLED_ARTIFACT_GRAPH[target as ProjectArtifactKind]?.dependsOn ?? [];
    const optionalKinds = contract?.optionalConsumes ?? [];
    const graphNode = CONTROLLED_ARTIFACT_GRAPH[target as ProjectArtifactKind];

    const missing: ArtifactKind[] = [];
    const steps: SchedulerStep[] = [];

    for (const reqKind of requiredKinds) {
      if (!this.hasReadyArtifact(reqKind, input.projectArtifacts)
          || rebuiltSet.has(reqKind as ProjectArtifactKind)) {
        const reqGraph = CONTROLLED_ARTIFACT_GRAPH[reqKind as ProjectArtifactKind];
        if (reqGraph) {
          if (visited.has(reqKind as ProjectArtifactKind)) {
            return {
              targetArtifact: target,
              requiredSteps: [],
              blockedReason: 'dependency cycle detected',
            };
          }
          const subPlan = this.planDependencyPath(reqKind as ProjectArtifactKind, input, new Set(visited), rebuiltSet, plannedSet);
          if (subPlan.blockedReason) {
            return subPlan;
          }
          steps.push(...subPlan.requiredSteps);
          if (subPlan.requiredSteps.length === 0 && !this.hasReadyArtifact(reqKind, input.projectArtifacts)) {
            missing.push(reqKind);
          }
        } else {
          missing.push(reqKind);
        }
      }
    }

    if (missing.length > 0) {
      return {
        targetArtifact: target,
        requiredSteps: [],
        blockedReason: 'upstream artifact missing',
      };
    }

    const missingOptional = optionalKinds.filter(
      (k) => !this.hasReadyArtifact(k, input.projectArtifacts),
    );
    const degradationWarning = missingOptional.length > 0
      ? `Degraded: missing optional artifacts: ${missingOptional.join(', ')}`
      : undefined;

    const consumedRefs = requiredKinds
      .filter((k: ArtifactKind) => input.projectArtifacts[k as ProjectArtifactKind])
      .map((k: ArtifactKind) => artifactToRef(input.projectArtifacts[k as ProjectArtifactKind]!));

    steps.push({
      stepId: `${target}-generate`,
      role: 'consumer',
      tool: graphNode?.defaultTool ?? 'generate_report',
      consumes: consumedRefs,
      provides: target,
      mode: 'execute',
      reason: degradationWarning
        ? `Generate ${target} (degraded: missing ${missingOptional.join(', ')})`
        : `Generate ${target} from available artifacts`,
    });

    return { targetArtifact: target, requiredSteps: steps };
  }

  private planDependencyPath(
    target: ProjectArtifactKind,
    input: SchedulerPlanInput,
    visited: Set<ProjectArtifactKind>,
    rebuiltSet: Set<ProjectArtifactKind>,
    plannedSet: Set<ProjectArtifactKind>,
  ): SchedulerPlan {
    if (visited.has(target)) {
      return {
        targetArtifact: target,
        requiredSteps: [],
        blockedReason: 'dependency cycle detected',
      };
    }
    visited.add(target);

    // Already planned in this session — steps were generated upstream.
    // rebuiltSet already reflects its status.
    if (plannedSet.has(target)) {
      return { targetArtifact: target, requiredSteps: [] };
    }

    const graphNode = CONTROLLED_ARTIFACT_GRAPH[target];
    if (!graphNode) {
      return { targetArtifact: target, requiredSteps: [] };
    }

    // Provider binding gates — check early when artifact is not ready (needs execution).
    // When artifact IS ready, defer to reuse check; if reuse passes, binding is irrelevant.
    const existingArtifact = input.projectArtifacts[target];
    if (!(existingArtifact && existingArtifact.status === 'ready')) {
      if (graphNode.providerSlot === 'analysisProvider' && !input.bindings.analysisProviderSkillId) {
        return {
          targetArtifact: target,
          requiredSteps: [],
          blockedReason: 'analysisProvider binding required',
        };
      }
      if (graphNode.providerSlot === 'codeCheckProvider' && !input.bindings.codeCheckProviderSkillId) {
        return {
          targetArtifact: target,
          requiredSteps: [],
          blockedReason: 'codeCheckProvider binding required',
        };
      }
    }

    // Traverse dependencies to populate rebuiltSet.
    // For leaf deps (no upstream deps of their own), only recurse if not ready.
    // For non-leaf deps, recurse when either:
    //   (a) the dep is not ready, or
    //   (b) a DraftState is present — fingerprints may change via DraftState hash
    // Without DraftState, ready non-leaf deps are trusted (their fingerprints
    // were correct when created and nothing upstream has changed).
    // Only treat DraftState as present when it carries a real structural type.
    // A placeholder draft (inferredType='unknown') from empty applyProvidedValues
    // should not trigger deep traversal.
    const draftPayload = input.sessionArtifacts?.draftState?.payload as Record<string, unknown> | undefined;
    const hasDraftState = Boolean(
      draftPayload
      && typeof draftPayload.inferredType === 'string'
      && draftPayload.inferredType !== 'unknown',
    );
    const steps: SchedulerStep[] = [];
    for (const dep of graphNode.dependsOn) {
      const depGraph = CONTROLLED_ARTIFACT_GRAPH[dep as ProjectArtifactKind];
      if (!depGraph) continue;
      const isLeafDep = depGraph.dependsOn.length === 0;
      const depReady = this.hasReadyArtifact(dep, input.projectArtifacts);
      const shouldRecurse = isLeafDep
        ? !depReady
        : !depReady || hasDraftState;
      if (shouldRecurse) {
        const subPlan = this.planDependencyPath(dep as ProjectArtifactKind, input, new Set(visited), rebuiltSet, plannedSet);
        if (subPlan.blockedReason) {
          return subPlan;
        }
        steps.push(...subPlan.requiredSteps);
      }
    }

    // If any dependency was rebuilt, skip reuse for this target
    const dependsOnRebuilt = graphNode.dependsOn.some(dep => rebuiltSet.has(dep as ProjectArtifactKind));

    // Reuse check (only when no dep was rebuilt)
    const existing = input.projectArtifacts[target];
    if (!dependsOnRebuilt && existing && existing.status === 'ready') {
      const depRefs: Record<string, { artifactId: string; revision: number }> = {};
      for (const dep of graphNode.dependsOn) {
        const depEnv = input.projectArtifacts[dep as ProjectArtifactKind];
        if (depEnv) {
          depRefs[dep] = { artifactId: depEnv.artifactId, revision: depEnv.revision };
        }
      }
      // Include DraftState content hash for normalizedModel fingerprint.
      // Only when hasDraftState is true (real structural type, not placeholder).
      // This gates change detection to sessions where a real draft exists.
      const draftStateHash = target === 'normalizedModel' && hasDraftState && input.sessionArtifacts?.draftState?.payload
        ? computeDraftStateContentHash(input.sessionArtifacts.draftState.payload as Record<string, unknown>)
        : undefined;
      // Only include provider bindings relevant to this artifact's provider slot
      const relevantBindings = graphNode.providerSlot === 'analysisProvider'
        ? { analysisProviderSkillId: input.bindings.analysisProviderSkillId }
        : graphNode.providerSlot === 'codeCheckProvider'
          ? { codeCheckProviderSkillId: input.bindings.codeCheckProviderSkillId }
          : undefined;
      const fp = computeDependencyFingerprint(depRefs, relevantBindings, draftStateHash);
      const expectedProducerSkillId = graphNode.providerSlot === 'analysisProvider'
        ? input.bindings.analysisProviderSkillId
        : graphNode.providerSlot === 'codeCheckProvider'
          ? input.bindings.codeCheckProviderSkillId
          : undefined;
      if (canReuseArtifact(existing, fp, input.requestOverrides?.forceRecompute ?? false, expectedProducerSkillId)) {
        plannedSet.add(target);
        return {
          targetArtifact: target,
          requiredSteps: [{
            stepId: `${target}-reuse`,
            role: graphNode.defaultRole,
            tool: graphNode.defaultTool,
            consumes: [],
            provides: target,
            mode: 'reuse',
            reason: `Reuse existing ${target} (fingerprint match)`,
          }],
        };
      }
    }

    // This artifact needs rebuild — add to rebuiltSet so dependents know
    rebuiltSet.add(target);
    plannedSet.add(target);

    if (graphNode.providerSlot) {
      const validationBinding = TOOL_BINDING_KEY['validate_model'];
      const validationSkillId = validationBinding === 'structural'
        ? input.structuralSkillId
        : validationBinding
          ? input.bindings?.[validationBinding]
          : undefined;
      steps.push({
        stepId: `${target}-validate_model`,
        role: 'validator',
        tool: 'validate_model',
        skillId: validationSkillId,
        consumes: this.collectRefs(graphNode.dependsOn, input.projectArtifacts),
        mode: 'execute',
        reason: `Validate before provider execution for ${target}`,
      });
    }

    // Spec section 10B.5: approval checkpoint before expensive provider execution
    if (graphNode.providerSlot && input.projectPolicy.requireApprovalBeforeExecution) {
      steps.push({
        stepId: `${target}-approval`,
        role: graphNode.defaultRole,
        tool: graphNode.defaultTool,
        consumes: this.collectRefs(graphNode.dependsOn, input.projectArtifacts),
        provides: target,
        mode: 'approval',
        reason: `Approval required before executing ${graphNode.defaultTool} to produce ${target}`,
      });
    }

    const targetMode = graphNode.providerSlot && input.projectPolicy.allowAsync
      ? 'queue-run'
      : 'execute';

    // Use 'draft_model' tool for normalizedModel when no existing model is present
    const actualTool = target === 'normalizedModel' && !input.projectArtifacts.normalizedModel
      ? 'draft_model'
      : graphNode.defaultTool;

    const bindingKey = graphNode.providerSlot ? `${graphNode.providerSlot}SkillId` as keyof import('./types.js').ProviderBindingState : undefined;

    const toolBinding = TOOL_BINDING_KEY[actualTool];
    const boundSkillId = bindingKey
      ? input.bindings?.[bindingKey]
      : toolBinding === 'structural'
        ? input.structuralSkillId
        : toolBinding
          ? input.bindings?.[toolBinding]
          : undefined;

    steps.push({
      stepId: `${target}-${actualTool}`,
      role: graphNode.defaultRole,
      tool: actualTool,
      skillId: boundSkillId,
      consumes: this.collectRefs(graphNode.dependsOn, input.projectArtifacts),
      provides: target,
      mode: targetMode,
      reason: `Execute ${actualTool} to produce ${target}`,
    });

    // Spec section 13.4: enricher steps after normalizedModel creation
    if (target === 'normalizedModel' && input.enricherContracts && input.enricherContracts.length > 0) {
      const sortedEnrichers = [...input.enricherContracts].sort((a, b) => a.priority - b.priority);
      for (const enricher of sortedEnrichers) {
        steps.push({
          stepId: `normalizedModel-enrich_model-${enricher.skillId}`,
          role: 'enricher',
          tool: 'enrich_model',
          skillId: enricher.skillId,
          consumes: input.projectArtifacts.normalizedModel
            ? [artifactToRef(input.projectArtifacts.normalizedModel)]
            : [],
          provides: 'normalizedModel',
          mode: 'execute',
          reason: `Enrich normalizedModel via ${enricher.skillId}`,
        });
      }
    }

    return { targetArtifact: target, requiredSteps: steps };
  }

  /**
   * Plan a design feedback step (spec section 7.3, 13.3).
   * Triggered when design iteration is requested after postprocess/code-check.
   */
  planDesignFeedback(input: SchedulerPlanInput): SchedulerPlan {
    const autoPolicy = input.projectPolicy?.autoDesignIterationPolicy;

    if (autoPolicy?.enabled && autoPolicy.maxIterations <= 0) {
      return {
        targetArtifact: 'normalizedModel',
        requiredSteps: [],
        blockedReason: 'autoDesignIteration not authorized',
      };
    }

    const mode = autoPolicy?.enabled ? 'execute' : 'propose';

    return {
      targetArtifact: 'normalizedModel',
      requiredSteps: [{
        stepId: 'design-feedback-propose',
        role: 'designer',
        tool: 'synthesize_design',
        skillId: input.selectedSkillIds.find((id) => id.startsWith('design-')),
        consumes: [
          ...(input.projectArtifacts.designBasis ? [artifactToRef(input.projectArtifacts.designBasis)] : []),
          ...(input.projectArtifacts.normalizedModel ? [artifactToRef(input.projectArtifacts.normalizedModel)] : []),
          ...(input.projectArtifacts.postprocessedResult ? [artifactToRef(input.projectArtifacts.postprocessedResult)] : []),
          ...(input.projectArtifacts.codeCheckResult ? [artifactToRef(input.projectArtifacts.codeCheckResult)] : []),
        ],
        provides: 'normalizedModel',
        mode,
        reason: 'Design feedback: propose model revision based on analysis/code-check results',
      }],
    };
  }

  private hasReadyArtifact(
    kind: ArtifactKind,
    artifacts: Partial<Record<ProjectArtifactKind, ArtifactEnvelope>>,
  ): boolean {
    const env = artifacts[kind as ProjectArtifactKind];
    return env != null && env.status === 'ready';
  }

  private collectRefs(
    kinds: ArtifactKind[],
    artifacts: Partial<Record<ProjectArtifactKind, ArtifactEnvelope>>,
  ): ArtifactRef[] {
    return kinds
      .filter((k) => artifacts[k as ProjectArtifactKind])
      .map((k) => artifactToRef(artifacts[k as ProjectArtifactKind]!));
  }
}
