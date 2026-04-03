import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';
import Fastify from 'fastify';

describe('user routes', () => {
  let app;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    organization: 'Test Corp',
    title: 'Engineer',
    avatar: null,
    bio: null,
    expertise: ['structural', 'concrete'],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  const mockDemoUser = {
    id: 'demo-user-1',
    email: 'demo@structureclaw.local',
    name: 'Demo User',
    organization: 'StructureClaw',
    title: 'Demo Engineer',
    avatar: null,
    bio: 'Automatically created local demo user.',
    expertise: ['structural-analysis', 'community'],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  const mockPublicProfile = {
    id: 'user-1',
    name: 'Test User',
    avatar: null,
    organization: 'Test Corp',
    title: 'Engineer',
    bio: 'A test bio',
    expertise: ['structural'],
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const mockTokenResponse = {
    token: 'dev-token-user-1',
    user: {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      avatar: null,
      organization: 'Test Corp',
      title: 'Engineer',
    },
  };

  const mockSkills = [
    { id: 'skill-1', name: 'Beam Design', tags: ['structural', 'concrete'] },
    { id: 'skill-2', name: 'Column Check', tags: ['steel'] },
  ];

  const mockProjects = [
    { id: 'proj-1', name: 'Building A', ownerId: 'user-1' },
    { id: 'proj-2', name: 'Bridge B', ownerId: 'user-1' },
  ];

  beforeAll(async () => {
    const { UserService } = await import('../dist/services/user.js');

    jest.spyOn(UserService.prototype, 'register').mockImplementation(async function (params) {
      return {
        token: `dev-token-${params.email}`,
        user: {
          id: 'user-new',
          email: params.email,
          name: params.name,
          organization: params.organization || null,
          title: params.title || null,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      };
    });

    jest.spyOn(UserService.prototype, 'login').mockImplementation(async function (params) {
      if (params.email === 'notfound@example.com') {
        throw new Error('邮箱或密码错误');
      }
      return { ...mockTokenResponse, token: `dev-token-${params.email}` };
    });

    jest.spyOn(UserService.prototype, 'getUserById').mockImplementation(async function (userId) {
      // Matches actual service behavior: ensureUserId falls back to demo user
      // when userId is undefined (unauthenticated request)
      if (!userId) return mockDemoUser;
      return { ...mockUser, id: userId };
    });

    jest.spyOn(UserService.prototype, 'updateProfile').mockImplementation(async function (userId, data) {
      return { ...mockUser, id: userId, ...data };
    });

    jest.spyOn(UserService.prototype, 'getPublicProfile').mockImplementation(async function (id) {
      if (id === 'not-found') return null;
      return { ...mockPublicProfile, id };
    });

    jest.spyOn(UserService.prototype, 'getUserSkills').mockImplementation(async function (id) {
      if (id === 'empty-user') return [];
      return mockSkills;
    });

    jest.spyOn(UserService.prototype, 'getUserProjects').mockImplementation(async function (id) {
      if (id === 'empty-user') return [];
      return mockProjects;
    });

    const { userRoutes } = await import('../dist/api/user.js');

    app = Fastify();
    await app.register(userRoutes);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // --- POST /register ---
  describe('POST /register', () => {
    test('registers a new user with valid data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'new@example.com',
          password: 'securepassword',
          name: 'New User',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe('new@example.com');
      expect(body.user.name).toBe('New User');
    });

    test('registers with optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'full@example.com',
          password: 'securepassword',
          name: 'Full User',
          organization: 'Acme Inc',
          title: 'Senior Engineer',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.organization).toBe('Acme Inc');
      expect(body.user.title).toBe('Senior Engineer');
    });

    test('rejects registration with invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'not-an-email',
          password: 'securepassword',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects registration with short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'valid@example.com',
          password: 'short',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects registration with short name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {
          email: 'valid@example.com',
          password: 'securepassword',
          name: 'X',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects registration with missing fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: {},
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects registration with no body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/register',
        payload: null,
      });

      expect(response.statusCode).toBe(500);
    });
  });

  // --- POST /login ---
  describe('POST /login', () => {
    test('logs in with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'test@example.com',
          password: 'securepassword',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
    });

    test('rejects login with invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'not-an-email',
          password: 'securepassword',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects login with missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          password: 'securepassword',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects login with missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        payload: {
          email: 'test@example.com',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  // --- GET /me ---
  describe('GET /me', () => {
    test('returns demo user when no user is authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/me',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // Actual behavior: getUserById(undefined) calls ensureUserId which
      // resolves to the demo user
      expect(body).toBeDefined();
      expect(body.id).toBe('demo-user-1');
      expect(body.email).toBe('demo@structureclaw.local');
    });
  });

  // --- PATCH /me ---
  describe('PATCH /me', () => {
    test('updates user profile with name', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/me',
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('Updated Name');
    });

    test('updates user profile with multiple fields', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/me',
        payload: {
          name: 'New Name',
          organization: 'New Org',
          title: 'New Title',
          bio: 'New bio text',
          expertise: ['structural', 'steel', 'concrete'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('New Name');
      expect(body.organization).toBe('New Org');
      expect(body.title).toBe('New Title');
      expect(body.bio).toBe('New bio text');
      expect(body.expertise).toEqual(['structural', 'steel', 'concrete']);
    });

    test('updates with empty body (no fields changed)', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/me',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // --- GET /:id (public profile) ---
  describe('GET /:id', () => {
    test('returns public profile for valid user id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/user-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe('user-1');
      expect(body.name).toBe('Test User');
    });

    test('returns null for non-existent user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/not-found',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toBeNull();
    });
  });

  // --- GET /:id/skills ---
  describe('GET /:id/skills', () => {
    test('returns skills for a user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/user-1/skills',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
      expect(body[0].name).toBe('Beam Design');
    });

    test('returns empty array for user with no skills', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/empty-user/skills',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    });
  });

  // --- GET /:id/projects ---
  describe('GET /:id/projects', () => {
    test('returns projects for a user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/user-1/projects',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
      expect(body[0].name).toBe('Building A');
    });

    test('returns empty array for user with no projects', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/empty-user/projects',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    });
  });
});
