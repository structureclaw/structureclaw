import { prisma } from '../utils/database.js';
import type { ArtifactKind, RunStatus, RunRecord } from '../agent-runtime/types.js';

function toRunRecord(row: {
  id: string;
  targetArtifact: string;
  toolId: string;
  providerSkillId: string | null;
  status: string;
  inputFingerprint: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  diagnostics: unknown;
}): RunRecord {
  return {
    runId: row.id,
    targetArtifact: row.targetArtifact as ArtifactKind,
    toolId: row.toolId,
    providerSkillId: row.providerSkillId ?? undefined,
    status: row.status as RunStatus,
    inputFingerprint: row.inputFingerprint,
    startedAt: row.startedAt?.getTime(),
    finishedAt: row.finishedAt?.getTime(),
    diagnostics: Array.isArray(row.diagnostics) ? row.diagnostics as string[] : undefined,
  };
}

export class AgentRunStoreService {
  async createRun(input: {
    projectId?: string;
    conversationId?: string;
    targetArtifact: ArtifactKind;
    toolId: string;
    providerSkillId?: string;
    status: RunStatus;
    inputFingerprint: string;
  }): Promise<RunRecord> {
    const created = await prisma.agentPipelineRun.create({
      data: {
        projectId: input.projectId,
        conversationId: input.conversationId,
        targetArtifact: input.targetArtifact,
        toolId: input.toolId,
        providerSkillId: input.providerSkillId,
        status: input.status,
        inputFingerprint: input.inputFingerprint,
      },
    });
    return toRunRecord(created);
  }

  async updateRun(id: string, patch: {
    status: RunStatus;
    diagnostics?: string[];
    startedAt?: Date;
    finishedAt?: Date;
  }): Promise<RunRecord> {
    const updated = await prisma.agentPipelineRun.update({
      where: { id },
      data: patch,
    });
    return toRunRecord(updated);
  }

  /**
   * Find the latest run matching the given filters. Used for in-flight run
   * detection (spec section 16 scenario 8).
   */
  async getLatestRun(input: {
    targetArtifact: ArtifactKind;
    projectId: string;
    statuses: RunStatus[];
  }): Promise<RunRecord | undefined> {
    const records = await prisma.agentPipelineRun.findMany({
      where: {
        targetArtifact: input.targetArtifact,
        projectId: input.projectId,
        status: { in: input.statuses },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    return records[0] ? toRunRecord(records[0]) : undefined;
  }
}
