import type {
  ArtifactKind,
  ArtifactEnvelope,
  ArtifactRef,
  ProjectArtifactKind,
  SchedulerAction,
  SchedulerStep,
  SchedulerInput,
  SchedulerPlan,
  SkillRole,
  ConsumerRuntimeContract,
} from './types.js';
import { canReuseArtifact, computeDependencyFingerprint } from './artifact-helpers.js';

// --- Controlled artifact graph ---

interface GraphNode {
  dependsOn: ArtifactKind[];
  providerSlot?: 'analysisProvider' | 'codeCheckProvider';
  defaultAction: SchedulerAction;
  defaultRole: SkillRole;
}

const CONTROLLED_ARTIFACT_GRAPH: Record<ProjectArtifactKind, GraphNode> = {
  designBasis: { dependsOn: [], defaultAction: 'update', defaultRole: 'entry' },
  normalizedModel: { dependsOn: ['designBasis'], defaultAction: 'update', defaultRole: 'enricher' },
  analysisModel: { dependsOn: ['designBasis', 'normalizedModel'], defaultAction: 'convert', defaultRole: 'transformer' },
  analysisRaw: { dependsOn: ['analysisModel'], providerSlot: 'analysisProvider', defaultAction: 'analyze', defaultRole: 'provider' },
  postprocessedResult: { dependsOn: ['analysisRaw'], defaultAction: 'postprocess', defaultRole: 'transformer' },
  codeCheckResult: { dependsOn: ['designBasis', 'normalizedModel', 'postprocessedResult'], providerSlot: 'codeCheckProvider', defaultAction: 'code_check', defaultRole: 'provider' },
  drawingArtifact: { dependsOn: ['designBasis', 'normalizedModel'], defaultAction: 'drawing', defaultRole: 'consumer' },
  reportArtifact: { dependsOn: ['designBasis', 'normalizedModel'], defaultAction: 'report', defaultRole: 'consumer' },
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

    if (CONSUMER_ARTIFACT_KINDS.has(target)) {
      return this.planConsumerPath(target, input, new Set());
    }

    return this.planDependencyPath(target, input, new Set());
  }

  private planConsumerPath(
    target: ArtifactKind,
    input: SchedulerPlanInput,
    visited: Set<ProjectArtifactKind>,
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
      if (!this.hasReadyArtifact(reqKind, input.projectArtifacts)) {
        const reqGraph = CONTROLLED_ARTIFACT_GRAPH[reqKind as ProjectArtifactKind];
        if (reqGraph) {
          if (visited.has(reqKind as ProjectArtifactKind)) {
            return {
              targetArtifact: target,
              requiredSteps: [],
              blockedReason: 'dependency cycle detected',
            };
          }
          const subPlan = this.planDependencyPath(reqKind as ProjectArtifactKind, input, new Set(visited));
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
      action: graphNode?.defaultAction ?? 'report',
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
  ): SchedulerPlan {
    if (visited.has(target)) {
      return {
        targetArtifact: target,
        requiredSteps: [],
        blockedReason: 'dependency cycle detected',
      };
    }
    visited.add(target);

    const graphNode = CONTROLLED_ARTIFACT_GRAPH[target];
    if (!graphNode) {
      return { targetArtifact: target, requiredSteps: [] };
    }

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

    const existing = input.projectArtifacts[target];
    if (existing && existing.status === 'ready') {
      const depRefs: Record<string, { artifactId: string; revision: number }> = {};
      for (const dep of graphNode.dependsOn) {
        const depEnv = input.projectArtifacts[dep as ProjectArtifactKind];
        if (depEnv) {
          depRefs[dep] = { artifactId: depEnv.artifactId, revision: depEnv.revision };
        }
      }
      const fp = computeDependencyFingerprint(depRefs, input.bindings);
      const expectedProducerSkillId = graphNode.providerSlot === 'analysisProvider'
        ? input.bindings.analysisProviderSkillId
        : graphNode.providerSlot === 'codeCheckProvider'
          ? input.bindings.codeCheckProviderSkillId
          : undefined;
      if (canReuseArtifact(existing, fp, input.requestOverrides?.forceRecompute ?? false, expectedProducerSkillId)) {
        return {
          targetArtifact: target,
          requiredSteps: [{
            stepId: `${target}-reuse`,
            role: graphNode.defaultRole,
            action: graphNode.defaultAction,
            consumes: [],
            provides: target,
            mode: 'reuse',
            reason: `Reuse existing ${target} (fingerprint match)`,
          }],
        };
      }
    }

    const steps: SchedulerStep[] = [];

    for (const dep of graphNode.dependsOn) {
      if (!this.hasReadyArtifact(dep, input.projectArtifacts)) {
        const depGraph = CONTROLLED_ARTIFACT_GRAPH[dep as ProjectArtifactKind];
        if (depGraph) {
          const subPlan = this.planDependencyPath(dep as ProjectArtifactKind, input, new Set(visited));
          if (subPlan.blockedReason) {
            return subPlan;
          }
          steps.push(...subPlan.requiredSteps);
        }
      }
    }

    if (graphNode.providerSlot) {
      steps.push({
        stepId: `${target}-validation`,
        role: 'validator',
        action: 'validate',
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
        action: graphNode.defaultAction,
        consumes: this.collectRefs(graphNode.dependsOn, input.projectArtifacts),
        provides: target,
        mode: 'approval',
        reason: `Approval required before executing ${graphNode.defaultAction} to produce ${target}`,
      });
    }

    const targetMode = graphNode.providerSlot && input.projectPolicy.allowAsync
      ? 'queue-run'
      : 'execute';

    const bindingKey = graphNode.providerSlot ? `${graphNode.providerSlot}SkillId` as keyof import('./types.js').ProviderBindingState : undefined;
    const boundSkillId = bindingKey ? input.bindings?.[bindingKey] : undefined;

    // Use 'draft' action for normalizedModel when no existing model is present
    const actualAction = target === 'normalizedModel' && !input.projectArtifacts.normalizedModel
      ? 'draft'
      : graphNode.defaultAction;

    steps.push({
      stepId: `${target}-execute`,
      role: graphNode.defaultRole,
      action: actualAction,
      skillId: boundSkillId,
      consumes: this.collectRefs(graphNode.dependsOn, input.projectArtifacts),
      provides: target,
      mode: targetMode,
      reason: `Execute ${actualAction} to produce ${target}`,
    });

    // Spec section 13.4: enricher steps after normalizedModel creation
    if (target === 'normalizedModel' && input.enricherContracts && input.enricherContracts.length > 0) {
      const sortedEnrichers = [...input.enricherContracts].sort((a, b) => a.priority - b.priority);
      for (const enricher of sortedEnrichers) {
        steps.push({
          stepId: `normalizedModel-enrich-${enricher.skillId}`,
          role: 'enricher',
          action: 'enrich',
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
        action: 'design',
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
