import { describe, expect, test, jest, beforeEach } from '@jest/globals';

/**
 * demo-data.ts exports:
 * - ensureDemoUser()              – upserts demo user via prisma
 * - ensureUserId(userId?)         – returns userId or creates demo user
 * - ensureProjectId(projectId?, ownerId?) – returns projectId or creates one
 *
 * We mock `../dist/utils/database.js` to isolate prisma calls.
 */

// ── Mock prisma ─────────────────────────────────────────────────────────────
const mockUserUpsert = jest.fn();
const mockProjectFindFirst = jest.fn();
const mockProjectCreate = jest.fn();

jest.unstable_mockModule('../dist/utils/database.js', () => ({
  prisma: {
    user: {
      upsert: mockUserUpsert,
    },
    project: {
      findFirst: mockProjectFindFirst,
      create: mockProjectCreate,
    },
  },
}));

// Import after mock setup
const { ensureDemoUser, ensureUserId, ensureProjectId } =
  await import('../dist/utils/demo-data.js');

// ── Constants ───────────────────────────────────────────────────────────────
const DEMO_USER_ID = 'user-demo-001';
const DEMO_PROJECT_ID = 'project-demo-001';

beforeEach(() => {
  mockUserUpsert.mockReset();
  mockProjectFindFirst.mockReset();
  mockProjectCreate.mockReset();
});

// ── ensureDemoUser ──────────────────────────────────────────────────────────

describe('ensureDemoUser', () => {
  test('should call prisma.user.upsert and return the result', async () => {
    const fakeUser = { id: DEMO_USER_ID, email: 'demo@structureclaw.local' };
    mockUserUpsert.mockResolvedValue(fakeUser);

    const result = await ensureDemoUser();

    expect(mockUserUpsert).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeUser);
  });

  test('should pass correct email in upsert where clause', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });

    await ensureDemoUser();

    const call = mockUserUpsert.mock.calls[0][0];
    expect(call.where.email).toBe('demo@structureclaw.local');
  });

  test('should not include passwordHash or expertiseItems in create payload', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });

    await ensureDemoUser();

    const call = mockUserUpsert.mock.calls[0][0];
    expect(call.create.passwordHash).toBeUndefined();
    expect(call.create.expertiseItems).toBeUndefined();
  });

  test('should propagate prisma errors', async () => {
    mockUserUpsert.mockRejectedValue(new Error('db connection lost'));

    await expect(ensureDemoUser()).rejects.toThrow('db connection lost');
  });
});

// ── ensureUserId ────────────────────────────────────────────────────────────

describe('ensureUserId', () => {
  test('should return the provided userId without calling prisma', async () => {
    const result = await ensureUserId('existing-user-id');

    expect(result).toBe('existing-user-id');
    expect(mockUserUpsert).not.toHaveBeenCalled();
  });

  test('should fall back to ensureDemoUser when userId is undefined', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });

    const result = await ensureUserId(undefined);

    expect(result).toBe(DEMO_USER_ID);
    expect(mockUserUpsert).toHaveBeenCalledTimes(1);
  });

  test('should fall back to ensureDemoUser when userId is empty string', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });

    const result = await ensureUserId('');

    expect(result).toBe(DEMO_USER_ID);
    expect(mockUserUpsert).toHaveBeenCalledTimes(1);
  });

  test('should fall back to ensureDemoUser when userId is null', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });

    const result = await ensureUserId(null);

    expect(result).toBe(DEMO_USER_ID);
    expect(mockUserUpsert).toHaveBeenCalledTimes(1);
  });
});

// ── ensureProjectId ─────────────────────────────────────────────────────────

describe('ensureProjectId', () => {
  test('should return the provided projectId without calling prisma', async () => {
    const result = await ensureProjectId('existing-project-id');

    expect(result).toBe('existing-project-id');
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
    expect(mockProjectCreate).not.toHaveBeenCalled();
  });

  test('should return existing project for owner when no projectId given', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });
    mockProjectFindFirst.mockResolvedValue({ id: DEMO_PROJECT_ID });

    const result = await ensureProjectId(undefined, DEMO_USER_ID);

    expect(result).toBe(DEMO_PROJECT_ID);
    expect(mockProjectFindFirst).toHaveBeenCalledWith({
      where: { ownerId: DEMO_USER_ID },
      orderBy: { createdAt: 'asc' },
    });
    expect(mockProjectCreate).not.toHaveBeenCalled();
  });

  test('should create a new project when owner has no projects', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });
    mockProjectFindFirst.mockResolvedValue(null);
    mockProjectCreate.mockResolvedValue({ id: DEMO_PROJECT_ID });

    const result = await ensureProjectId(undefined, DEMO_USER_ID);

    expect(result).toBe(DEMO_PROJECT_ID);
    expect(mockProjectCreate).toHaveBeenCalledTimes(1);

    const createData = mockProjectCreate.mock.calls[0][0].data;
    expect(createData.name).toBe('Demo Project');
    expect(createData.type).toBe('building');
    expect(createData.ownerId).toBe(DEMO_USER_ID);
    expect(createData.settings).toEqual({ designCode: 'GB50010' });
    expect(createData.location).toEqual({
      city: 'Local',
      province: 'Local',
      seismicZone: 8,
      windZone: 2,
    });
  });

  test('should resolve ownerId via ensureUserId when ownerId not provided', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });
    mockProjectFindFirst.mockResolvedValue({ id: DEMO_PROJECT_ID });

    await ensureProjectId(undefined, undefined);

    // ensureUserId(undefined) should have triggered ensureDemoUser
    expect(mockUserUpsert).toHaveBeenCalledTimes(1);
  });

  test('should propagate prisma findFirst errors', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });
    mockProjectFindFirst.mockRejectedValue(new Error('query failed'));

    await expect(ensureProjectId(undefined, DEMO_USER_ID)).rejects.toThrow(
      'query failed'
    );
  });

  test('should propagate prisma create errors', async () => {
    mockUserUpsert.mockResolvedValue({ id: DEMO_USER_ID });
    mockProjectFindFirst.mockResolvedValue(null);
    mockProjectCreate.mockRejectedValue(new Error('write failed'));

    await expect(ensureProjectId(undefined, DEMO_USER_ID)).rejects.toThrow(
      'write failed'
    );
  });
});
