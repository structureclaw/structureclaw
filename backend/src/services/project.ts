import { prisma } from '../utils/database.js';
import { ensureUserId } from '../utils/demo-data.js';
import type { InputJsonValue } from '../utils/json.js';

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
        skills: true,
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
    const [memberCount, modelCount, analysisCount, skillCount] = await Promise.all([
      prisma.projectMember.count({ where: { projectId: id } }),
      prisma.structuralModel.count({ where: { projectId: id } }),
      prisma.analysis.count({
        where: {
          model: {
            projectId: id,
          },
        },
      }),
      prisma.projectSkill.count({ where: { projectId: id } }),
    ]);

    return {
      projectId: id,
      members: memberCount,
      models: modelCount,
      analyses: analysisCount,
      skills: skillCount,
    };
  }
}
