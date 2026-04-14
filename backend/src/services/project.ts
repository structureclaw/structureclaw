import { prisma } from '../utils/database.js';
import { ensureUserId } from '../utils/demo-data.js';
import type { InputJsonValue } from '../utils/json.js';
import type {
  ProjectExecutionPolicy,
  ProjectPipelineState,
} from '../agent-runtime/types.js';
import { createEmptyProjectPipelineState } from './agent-pipeline-state.js';

interface CreateProjectParams {
  name: string;
  description?: string;
  type: string;
  location?: InputJsonValue;
  settings?: InputJsonValue;
  ownerId?: string;
}

interface ListProjectParams {
  status?: string;
  search?: string;
}

export class ProjectService {
  async createProject(params: CreateProjectParams) {
    const ownerId = await ensureUserId(params.ownerId);

    return prisma.project.create({
      data: {
        name: params.name,
        description: params.description,
        type: params.type,
        location: params.location,
        settings: params.settings,
        ownerId,
      },
    });
  }

  async listProjects(userId?: string, filters: ListProjectParams = {}) {
    const where: Record<string, unknown> = {};

    if (userId) {
      where.OR = [
        { ownerId: userId },
        { members: { some: { userId } } },
      ];
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where.OR = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { name: { contains: filters.search } },
        { description: { contains: filters.search } },
      ];
    }

    return prisma.project.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            members: true,
            models: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  async getProject(id: string) {
    return prisma.project.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        models: {
          orderBy: { updatedAt: 'desc' },
          include: {
            analyses: {
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
      },
    });
  }

  async updateProject(id: string, data: Record<string, unknown>) {
    return prisma.project.update({
      where: { id },
      data,
    });
  }

  async deleteProject(id: string) {
    return prisma.project.delete({
      where: { id },
    });
  }

  async addMember(projectId: string, userId: string, role: string) {
    return prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
      create: {
        projectId,
        userId,
        role,
      },
      update: {
        role,
      },
    });
  }

  async getProjectStats(id: string) {
    const [memberCount, modelCount, analysisCount] = await Promise.all([
      prisma.projectMember.count({ where: { projectId: id } }),
      prisma.structuralModel.count({ where: { projectId: id } }),
      prisma.analysis.count({
        where: {
          model: {
            projectId: id,
          },
        },
      }),
    ]);

    return {
      projectId: id,
      members: memberCount,
      models: modelCount,
      analyses: analysisCount,
    };
  }

  async getProjectExecutionPolicy(id: string): Promise<ProjectExecutionPolicy> {
    const project = await prisma.project.findUnique({
      where: { id },
      select: { settings: true },
    });
    const settings = project?.settings && typeof project.settings === 'object'
      ? project.settings as Record<string, unknown>
      : {};
    return (settings.agentExecutionPolicy as ProjectExecutionPolicy | undefined) ?? {};
  }

  async updateProjectExecutionPolicy(id: string, policy: ProjectExecutionPolicy) {
    const project = await prisma.project.findUnique({ where: { id }, select: { settings: true } });
    const settings = project?.settings && typeof project.settings === 'object'
      ? project.settings as Record<string, unknown>
      : {};
    return prisma.project.update({
      where: { id },
      data: {
        settings: {
          ...settings,
          agentExecutionPolicy: policy as unknown as InputJsonValue,
        },
      },
    });
  }

  async getProjectPipelineState(id: string): Promise<ProjectPipelineState> {
    const project = await prisma.project.findUnique({
      where: { id },
      select: { settings: true },
    });
    const settings = project?.settings && typeof project.settings === 'object'
      ? project.settings as Record<string, unknown>
      : {};
    return (settings.agentPipelineState as ProjectPipelineState | undefined)
      ?? createEmptyProjectPipelineState(
        (settings.agentExecutionPolicy as ProjectExecutionPolicy | undefined) ?? {},
      );
  }

  async updateProjectPipelineState(id: string, pipelineState: ProjectPipelineState) {
    const project = await prisma.project.findUnique({ where: { id }, select: { settings: true } });
    const settings = project?.settings && typeof project.settings === 'object'
      ? project.settings as Record<string, unknown>
      : {};
    return prisma.project.update({
      where: { id },
      data: {
        settings: {
          ...settings,
          agentPipelineState: pipelineState as unknown as InputJsonValue,
        },
      },
    });
  }
}
