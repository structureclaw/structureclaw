import { beforeEach, describe, expect, test } from '@jest/globals';
import { prisma } from '../dist/utils/database.js';
import { ProjectService } from '../dist/services/project.js';

describe('sqlite relation-backed array mapping', () => {
  beforeEach(() => {
    prisma.user.findUnique = async () => null;
    prisma.user.upsert = async ({ create }) => ({
      id: create.ownerId ?? 'demo-user-1',
      email: create.email ?? 'demo@structureclaw.local',
      name: create.name ?? 'Demo User',
      avatar: null,
      organization: null,
      title: null,
      bio: null,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    });
  });

  test('should include project members through relation', async () => {
    prisma.project.findUnique = async () => ({
      id: 'project-1',
      name: 'Test Project',
      description: null,
      type: 'building',
      location: null,
      settings: null,
      status: 'active',
      ownerId: 'user-1',
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      owner: { id: 'user-1', name: 'Owner', email: 'owner@test.com' },
      members: [
        { id: 'pm-1', userId: 'user-2', role: 'member', joinedAt: new Date('2026-03-20T00:00:00.000Z'), user: { id: 'user-2', name: 'Member One', email: 'm1@test.com' } },
        { id: 'pm-2', userId: 'user-3', role: 'member', joinedAt: new Date('2026-03-20T00:00:00.000Z'), user: { id: 'user-3', name: 'Member Two', email: 'm2@test.com' } },
      ],
      models: [],
    });

    const svc = new ProjectService();
    const result = await svc.getProject('project-1');

    expect(result.members).toHaveLength(2);
    expect(result.members[0].user.name).toBe('Member One');
    expect(result.members[1].user.name).toBe('Member Two');
  });

  test('should return project stats counting relations', async () => {
    prisma.projectMember.count = async () => 3;
    prisma.structuralModel.count = async () => 5;
    prisma.analysis.count = async () => 12;

    const svc = new ProjectService();
    const stats = await svc.getProjectStats('project-1');

    expect(stats.members).toBe(3);
    expect(stats.models).toBe(5);
    expect(stats.analyses).toBe(12);
  });
});
