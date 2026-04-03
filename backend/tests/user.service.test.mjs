import { beforeEach, describe, expect, test, jest } from '@jest/globals';
import { prisma } from '../dist/utils/database.js';

jest.unstable_mockModule('../dist/utils/demo-data.js', () => ({
  ensureUserId: jest.fn(),
  hashPassword: jest.fn((pw) => `hashed-${pw}`),
}));

const { ensureUserId } = await import('../dist/utils/demo-data.js');
const { UserService } = await import('../dist/services/user.js');

const mockUserRecord = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  avatar: null,
  organization: 'TestOrg',
  title: 'Engineer',
  bio: 'Hello',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
};

describe('UserService', () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new UserService();
  });

  describe('register', () => {
    test('creates a new user and returns user + token', async () => {
      prisma.user.create = jest.fn().mockResolvedValue({
        id: 'user-new',
        email: 'new@example.com',
        name: 'New User',
        organization: null,
        title: null,
        createdAt: '2025-01-01T00:00:00.000Z',
      });

      const result = await svc.register({
        email: 'new@example.com',
        password: 'secret123',
        name: 'New User',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'new@example.com',
          passwordHash: `hashed-secret123`,
          name: 'New User',
          organization: undefined,
          title: undefined,
        },
        select: {
          id: true,
          email: true,
          name: true,
          organization: true,
          title: true,
          createdAt: true,
        },
      });
      expect(result.user.id).toBe('user-new');
      expect(result.token).toBe('dev-token-user-new');
    });

    test('passes organization and title when provided', async () => {
      prisma.user.create = jest.fn().mockResolvedValue({
        id: 'user-2',
        email: 'org@example.com',
        name: 'Org User',
        organization: 'Acme',
        title: 'Senior Engineer',
        createdAt: '2025-01-01T00:00:00.000Z',
      });

      await svc.register({
        email: 'org@example.com',
        password: 'pass',
        name: 'Org User',
        organization: 'Acme',
        title: 'Senior Engineer',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization: 'Acme',
            title: 'Senior Engineer',
          }),
        }),
      );
    });

    test('propagates error when prisma create fails', async () => {
      prisma.user.create = jest.fn().mockRejectedValue(new Error('duplicate email'));

      await expect(
        svc.register({ email: 'dup@example.com', password: 'pass', name: 'Dup' }),
      ).rejects.toThrow('duplicate email');
    });
  });

  describe('login', () => {
    test('returns token and user when credentials are correct', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        passwordHash: 'hashed-mypass',
      });

      const result = await svc.login({ email: 'test@example.com', password: 'mypass' });

      expect(result.token).toBe('dev-token-user-1');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.name).toBe('Test User');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    test('throws when user is not found', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue(null);

      await expect(
        svc.login({ email: 'missing@example.com', password: 'pass' }),
      ).rejects.toThrow('邮箱或密码错误');
    });

    test('throws when password does not match', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        passwordHash: 'hashed-correct',
      });

      // hashPassword('wrong') returns 'hashed-wrong' which !== 'hashed-correct'
      await expect(
        svc.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow('邮箱或密码错误');
    });

    test('throws when user has null passwordHash', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        passwordHash: null,
      });

      await expect(
        svc.login({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toThrow('邮箱或密码错误');
    });
  });

  describe('getUserById', () => {
    test('returns mapped user when found', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        expertiseItems: [{ value: 'structural-analysis' }, { value: 'bridges' }],
      });

      const result = await svc.getUserById('user-1');

      expect(ensureUserId).toHaveBeenCalledWith('user-1');
      expect(result.id).toBe('user-1');
      expect(result.expertise).toEqual(['structural-analysis', 'bridges']);
      expect(result).not.toHaveProperty('expertiseItems');
    });

    test('returns null when user not found', async () => {
      ensureUserId.mockResolvedValue('user-missing');
      prisma.user.findUnique = jest.fn().mockResolvedValue(null);

      const result = await svc.getUserById('user-missing');

      expect(result).toBeNull();
    });

    test('resolves demo user when userId is undefined', async () => {
      ensureUserId.mockResolvedValue('demo-user-id');
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        id: 'demo-user-id',
        email: 'demo@structureclaw.local',
        name: 'Demo User',
        expertiseItems: [],
      });

      const result = await svc.getUserById(undefined);

      expect(ensureUserId).toHaveBeenCalledWith(undefined);
      expect(result.id).toBe('demo-user-id');
      expect(result.expertise).toEqual([]);
    });

    test('maps null expertiseItems to empty array', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        expertiseItems: null,
      });

      const result = await svc.getUserById('user-1');

      expect(result.expertise).toEqual([]);
    });

    test('selects expected fields including expertiseItems', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.user.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getUserById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          select: expect.objectContaining({
            expertiseItems: {
              select: { value: true },
              orderBy: { position: 'asc' },
            },
          }),
        }),
      );
    });
  });

  describe('updateProfile', () => {
    test('updates profile without expertise', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.user.update = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        name: 'Updated Name',
        expertiseItems: [],
      });

      const result = await svc.updateProfile('user-1', { name: 'Updated Name' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.not.objectContaining({ expertiseItems: expect.anything() }),
        }),
      );
      expect(result.name).toBe('Updated Name');
      expect(result.expertise).toEqual([]);
    });

    test('updates profile with expertise array', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.user.update = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        expertiseItems: [{ value: 'seismic' }, { value: 'steel' }],
      });

      const result = await svc.updateProfile('user-1', {
        expertise: ['seismic', 'steel'],
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expertiseItems: {
              deleteMany: {},
              create: [
                { value: 'seismic', position: 0 },
                { value: 'steel', position: 1 },
              ],
            },
          }),
        }),
      );
      expect(result.expertise).toEqual(['seismic', 'steel']);
    });

    test('resolves userId via ensureUserId when undefined', async () => {
      ensureUserId.mockResolvedValue('demo-user-id');
      prisma.user.update = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        id: 'demo-user-id',
        expertiseItems: [],
      });

      await svc.updateProfile(undefined, { bio: 'demo bio' });

      expect(ensureUserId).toHaveBeenCalledWith(undefined);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'demo-user-id' } }),
      );
    });

    test('maps expertiseItems in response to expertise array', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.user.update = jest.fn().mockResolvedValue({
        ...mockUserRecord,
        expertiseItems: [{ value: 'concrete' }],
      });

      const result = await svc.updateProfile('user-1', {});

      expect(result).not.toHaveProperty('expertiseItems');
      expect(result.expertise).toEqual(['concrete']);
    });

    test('propagates error when prisma update fails', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.user.update = jest.fn().mockRejectedValue(new Error('not found'));

      await expect(
        svc.updateProfile('user-1', { name: 'fail' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('getPublicProfile', () => {
    test('returns mapped public profile when found', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        id: 'user-1',
        name: 'Public User',
        avatar: 'avatar.png',
        organization: 'Org',
        title: 'Eng',
        bio: 'Bio text',
        expertiseItems: [{ value: 'tall-buildings' }],
        createdAt: '2025-01-01T00:00:00.000Z',
      });

      const result = await svc.getPublicProfile('user-1');

      expect(result.id).toBe('user-1');
      expect(result.name).toBe('Public User');
      expect(result.expertise).toEqual(['tall-buildings']);
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('expertiseItems');
    });

    test('returns null when user not found', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue(null);

      const result = await svc.getPublicProfile('nonexistent');

      expect(result).toBeNull();
    });

    test('selects only public fields (no email, no passwordHash)', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getPublicProfile('user-1');

      const call = prisma.user.findUnique.mock.calls[0][0];
      expect(call.select).not.toHaveProperty('email');
      expect(call.select).not.toHaveProperty('passwordHash');
      expect(call.select).toHaveProperty('name');
      expect(call.select).toHaveProperty('bio');
    });

    test('maps empty expertiseItems to empty array', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        id: 'user-1',
        name: 'No Skills',
        expertiseItems: [],
      });

      const result = await svc.getPublicProfile('user-1');

      expect(result.expertise).toEqual([]);
    });
  });

  describe('getUserSkills', () => {
    test('returns skills with tags mapped from tagItems', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([
        { id: 'skill-1', name: 'Seismic Design', tagItems: [{ value: 'earthquake' }, { value: 'analysis' }] },
        { id: 'skill-2', name: 'Wind Load', tagItems: [] },
      ]);

      const result = await svc.getUserSkills('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].tags).toEqual(['earthquake', 'analysis']);
      expect(result[0]).not.toHaveProperty('tagItems');
      expect(result[1].tags).toEqual([]);
    });

    test('returns empty array when user has no skills', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.getUserSkills('user-1');

      expect(result).toEqual([]);
    });

    test('queries with correct author filter and limits', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.getUserSkills('user-1');

      expect(prisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { authorId: 'user-1' },
          take: 50,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('getUserProjects', () => {
    test('returns projects where user is owner or member', async () => {
      const projects = [
        { id: 'proj-1', name: 'Owned', ownerId: 'user-1' },
        { id: 'proj-2', name: 'Member', ownerId: 'other' },
      ];
      prisma.project.findMany = jest.fn().mockResolvedValue(projects);

      const result = await svc.getUserProjects('user-1');

      expect(result).toEqual(projects);
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { ownerId: 'user-1' },
              { members: { some: { userId: 'user-1' } } },
            ],
          },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });

    test('returns empty array when user has no projects', async () => {
      prisma.project.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.getUserProjects('user-1');

      expect(result).toEqual([]);
    });
  });
});
