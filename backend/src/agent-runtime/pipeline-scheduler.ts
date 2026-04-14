import type {
  ArtifactKind,
  ArtifactEnvelope,
  ArtifactRef,
  ProjectArtifactKind,
  ProjectExecutionPolicy,
  ProviderBindingState,
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
}

export class PipelineScheduler {
  plan(input: SchedulerPlanInput): SchedulerPlan {
    if (input.targetArtifact === 'chatReply') {
      return { targetArtifact: 'chatReply', requiredSteps: [] };
    }

    if (input.targetArtifact === 'draftState') {
      return { targetArtifact: 'chatReply', requiredSteps: [] };
    }

    const target = input.targetArtifact as ProjectArtifactKind;

    if (!this.hasReadyArtifact('designBasis', input.projectArtifacts)) {
      return {
        targetArtifact: target,
        requiredSteps: [],
        blockedReason: 'designBasis incomplete',
      };
    }

    if (CONSUMER_ARTIFACT_KINDS.has(target)) {
      return this.planConsumerPath(target, input);
    }

    return this.planDependencyPath(target, input);
  }

  private planConsumerPath(
    target: ArtifactKind,
    input: SchedulerPlanInput,
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
          const subPlan = this.planDependencyPath(reqKind as ProjectArtifactKind, input);
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
  ): SchedulerPlan {
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
      if (canReuseArtifact(existing, fp, input.requestOverrides?.forceRecompute ?? false)) {
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
          const subPlan = this.planDependencyPath(dep as ProjectArtifactKind, input);
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

    const targetMode = graphNode.providerSlot && input.projectPolicy.allowAsync
      ? 'queue-run'
      : 'execute';

    steps.push({
      stepId: `${target}-execute`,
      role: graphNode.defaultRole,
      action: graphNode.defaultAction,
      consumes: this.collectRefs(graphNode.dependsOn, input.projectArtifacts),
      provides: target,
      mode: targetMode,
      reason: `Execute ${graphNode.defaultAction} to produce ${target}`,
    });

    return { targetArtifact: target, requiredSteps: steps };
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
