import { beforeEach, describe, expect, test, jest } from '@jest/globals';
import { prisma } from '../dist/utils/database.js';

jest.unstable_mockModule('../dist/utils/demo-data.js', () => ({
  ensureUserId: jest.fn(),
}));

const { ensureUserId } = await import('../dist/utils/demo-data.js');
const { ProjectService } = await import('../dist/services/project.js');

describe('ProjectService', () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ProjectService();
  });

  describe('createProject', () => {
    test('creates a project with all fields', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.project.create = jest.fn().mockResolvedValue({
        id: 'proj-1',
        name: 'Tower A',
        description: 'A tall tower',
        type: 'building',
        location: { city: 'Shanghai' },
        settings: { units: 'metric' },
        ownerId: 'user-1',
      });

      const result = await svc.createProject({
        name: 'Tower A',
        description: 'A tall tower',
        type: 'building',
        location: { city: 'Shanghai' },
        settings: { units: 'metric' },
        ownerId: 'user-1',
      });

      expect(result.id).toBe('proj-1');
      expect(result.name).toBe('Tower A');
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: {
          name: 'Tower A',
          description: 'A tall tower',
          type: 'building',
          location: { city: 'Shanghai' },
          settings: { units: 'metric' },
          ownerId: 'user-1',
        },
      });
    });

    test('resolves ownerId via ensureUserId when not provided', async () => {
      ensureUserId.mockResolvedValue('demo-user-id');
      prisma.project.create = jest.fn().mockResolvedValue({ id: 'proj-2', ownerId: 'demo-user-id' });

      await svc.createProject({ name: 'Demo Proj', type: 'bridge' });

      expect(ensureUserId).toHaveBeenCalledWith(undefined);
      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: 'demo-user-id' }),
        }),
      );
    });

    test('creates project with minimal fields', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.project.create = jest.fn().mockResolvedValue({ id: 'proj-3' });

      const result = await svc.createProject({ name: 'Minimal', type: 'beam' });

      expect(prisma.project.create).toHaveBeenCalledWith({
        data: {
          name: 'Minimal',
          description: undefined,
          type: 'beam',
          location: undefined,
          settings: undefined,
          ownerId: 'user-1',
        },
      });
    });

    test('propagates error when prisma create fails', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.project.create = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(
        svc.createProject({ name: 'Fail', type: 'x' }),
      ).rejects.toThrow('db error');
    });
  });

  describe('listProjects', () => {
    test('returns projects filtered by userId with owner or member match', async () => {
      const projects = [{ id: 'proj-1', name: 'P1' }];
      prisma.project.findMany = jest.fn().mockResolvedValue(projects);

      const result = await svc.listProjects('user-1');

      expect(result).toEqual(projects);
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { ownerId: 'user-1' },
              { members: { some: { userId: 'user-1' } } },
            ],
          },
          take: 100,
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });

    test('returns projects with status filter only', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      await svc.listProjects(undefined, { status: 'active' });

      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('active');
      expect(where.OR).toBeUndefined();
    });

    test('returns projects with search filter only', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      await svc.listProjects(undefined, { search: 'tower' });

      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { name: { contains: 'tower' } },
        { description: { contains: 'tower' } },
      ]);
    });

    test('combines userId, status, and search filters', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      await svc.listProjects('user-1', { status: 'active', search: 'tower' });

      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('active');
      // OR should have owner/member conditions plus search conditions (4 total)
      expect(where.OR).toHaveLength(4);
      expect(where.OR).toEqual([
        { ownerId: 'user-1' },
        { members: { some: { userId: 'user-1' } } },
        { name: { contains: 'tower' } },
        { description: { contains: 'tower' } },
      ]);
    });

    test('returns projects without any filters', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.listProjects();

      expect(result).toEqual([]);
      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(Object.keys(where)).toHaveLength(0);
    });

    test('includes owner and count relations', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      await svc.listProjects('user-1');

      const call = prisma.project.findMany.mock.calls[0][0];
      expect(call.include).toEqual({
        owner: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { members: true, models: true },
        },
      });
    });

    test('search filter with userId merges OR conditions correctly', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      await svc.listProjects('user-1', { search: 'bridge' });

      const where = prisma.project.findMany.mock.calls[0][0].where;
      // userId OR (2 items) + search OR (2 items) merged into single array = 4
      expect(where.OR).toHaveLength(4);
    });

    test('userId filter only without search or status', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      await svc.listProjects('user-1', {});

      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(2);
      expect(where.OR).toEqual([
        { ownerId: 'user-1' },
        { members: { some: { userId: 'user-1' } } },
      ]);
    });
  });

  describe('getProject', () => {
    test('returns project with full relations when found', async () => {
      const project = {
        id: 'proj-1',
        name: 'Tower',
        owner: { id: 'user-1', name: 'Owner', email: 'o@x.com' },
        members: [],
        models: [],
        skills: [],
      };
      prisma.project.findUnique = jest.fn().mockResolvedValue(project);

      const result = await svc.getProject('proj-1');

      expect(result).toEqual(project);
      expect(prisma.project.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proj-1' },
        }),
      );
    });

    test('returns null when project not found', async () => {
      prisma.project.findUnique = jest.fn().mockResolvedValue(null);

      const result = await svc.getProject('nonexistent');

      expect(result).toBeNull();
    });

    test('includes all expected relations', async () => {
      prisma.project.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getProject('proj-1');

      const call = prisma.project.findUnique.mock.calls[0][0];
      expect(call.include).toHaveProperty('owner');
      expect(call.include).toHaveProperty('members');
      expect(call.include).toHaveProperty('models');
      expect(call.include).toHaveProperty('skills');
    });

    test('models include analyses limited to 10 and ordered by newest first', async () => {
      prisma.project.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getProject('proj-1');

      const call = prisma.project.findUnique.mock.calls[0][0];
      const modelsInclude = call.include.models;
      expect(modelsInclude.include.analyses.take).toBe(10);
      expect(modelsInclude.include.analyses.orderBy).toEqual({ createdAt: 'desc' });
      expect(modelsInclude.orderBy).toEqual({ updatedAt: 'desc' });
    });
  });

  describe('updateProject', () => {
    test('updates project with given data', async () => {
      const updated = { id: 'proj-1', name: 'Updated Tower' };
      prisma.project.update = jest.fn().mockResolvedValue(updated);

      const result = await svc.updateProject('proj-1', { name: 'Updated Tower' });

      expect(result).toEqual(updated);
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { name: 'Updated Tower' },
      });
    });

    test('propagates error when project not found', async () => {
      prisma.project.update = jest.fn().mockRejectedValue(new Error('record not found'));

      await expect(
        svc.updateProject('nonexistent', { name: 'X' }),
      ).rejects.toThrow('record not found');
    });

    test('updates multiple fields at once', async () => {
      prisma.project.update = jest.fn().mockResolvedValue({ id: 'proj-1' });

      await svc.updateProject('proj-1', { name: 'New', description: 'Desc', status: 'archived' });

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { name: 'New', description: 'Desc', status: 'archived' },
      });
    });
  });

  describe('deleteProject', () => {
    test('deletes a project by id', async () => {
      const deleted = { id: 'proj-1', name: 'Deleted' };
      prisma.project.delete = jest.fn().mockResolvedValue(deleted);

      const result = await svc.deleteProject('proj-1');

      expect(result).toEqual(deleted);
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'proj-1' } });
    });

    test('propagates error when deleting nonexistent project', async () => {
      prisma.project.delete = jest.fn().mockRejectedValue(new Error('not found'));

      await expect(svc.deleteProject('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('addMember', () => {
    test('creates new member when not existing', async () => {
      const member = { projectId: 'proj-1', userId: 'user-2', role: 'editor' };
      prisma.projectMember.upsert = jest.fn().mockResolvedValue(member);

      const result = await svc.addMember('proj-1', 'user-2', 'editor');

      expect(result).toEqual(member);
      expect(prisma.projectMember.upsert).toHaveBeenCalledWith({
        where: {
          projectId_userId: { projectId: 'proj-1', userId: 'user-2' },
        },
        create: { projectId: 'proj-1', userId: 'user-2', role: 'editor' },
        update: { role: 'editor' },
      });
    });

    test('updates role when member already exists', async () => {
      const updated = { projectId: 'proj-1', userId: 'user-2', role: 'admin' };
      prisma.projectMember.upsert = jest.fn().mockResolvedValue(updated);

      const result = await svc.addMember('proj-1', 'user-2', 'admin');

      expect(result.role).toBe('admin');
      const call = prisma.projectMember.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ role: 'admin' });
    });

    test('propagates error when upsert fails', async () => {
      prisma.projectMember.upsert = jest.fn().mockRejectedValue(new Error('constraint'));

      await expect(
        svc.addMember('proj-1', 'user-2', 'viewer'),
      ).rejects.toThrow('constraint');
    });
  });

  describe('getProjectStats', () => {
    test('returns aggregated stats for a project', async () => {
      prisma.projectMember.count = jest.fn().mockResolvedValue(3);
      prisma.structuralModel.count = jest.fn().mockResolvedValue(5);
      prisma.analysis.count = jest.fn().mockResolvedValue(12);
      prisma.projectSkill.count = jest.fn().mockResolvedValue(2);

      const result = await svc.getProjectStats('proj-1');

      expect(result).toEqual({
        projectId: 'proj-1',
        members: 3,
        models: 5,
        analyses: 12,
        skills: 2,
      });
    });

    test('returns zeros for a project with no data', async () => {
      prisma.projectMember.count = jest.fn().mockResolvedValue(0);
      prisma.structuralModel.count = jest.fn().mockResolvedValue(0);
      prisma.analysis.count = jest.fn().mockResolvedValue(0);
      prisma.projectSkill.count = jest.fn().mockResolvedValue(0);

      const result = await svc.getProjectStats('proj-empty');

      expect(result).toEqual({
        projectId: 'proj-empty',
        members: 0,
        models: 0,
        analyses: 0,
        skills: 0,
      });
    });

    test('queries with correct projectId filters', async () => {
      prisma.projectMember.count = jest.fn().mockResolvedValue(0);
      prisma.structuralModel.count = jest.fn().mockResolvedValue(0);
      prisma.analysis.count = jest.fn().mockResolvedValue(0);
      prisma.projectSkill.count = jest.fn().mockResolvedValue(0);

      await svc.getProjectStats('proj-1');

      expect(prisma.projectMember.count).toHaveBeenCalledWith({ where: { projectId: 'proj-1' } });
      expect(prisma.structuralModel.count).toHaveBeenCalledWith({ where: { projectId: 'proj-1' } });
      expect(prisma.analysis.count).toHaveBeenCalledWith({
        where: { model: { projectId: 'proj-1' } },
      });
      expect(prisma.projectSkill.count).toHaveBeenCalledWith({ where: { projectId: 'proj-1' } });
    });
  });
});
