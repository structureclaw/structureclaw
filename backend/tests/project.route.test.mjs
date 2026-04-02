import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';
import Fastify from 'fastify';

describe('project routes', () => {
  let app;

  const mockProject = {
    id: 'proj-1',
    name: 'Test Building',
    type: 'building',
    description: 'A test project',
    ownerId: 'user-1',
    status: 'active',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  const mockProjectDetail = {
    ...mockProject,
    owner: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    members: [],
    models: [],
    skills: [],
  };

  const mockStats = {
    projectId: 'proj-1',
    members: 2,
    models: 5,
    analyses: 10,
    skills: 3,
  };

  const mockMember = {
    projectId: 'proj-1',
    userId: 'user-2',
    role: 'viewer',
  };

  beforeAll(async () => {
    const { ProjectService } = await import('../dist/services/project.js');

    jest.spyOn(ProjectService.prototype, 'createProject').mockImplementation(async function (params) {
      return { ...mockProject, name: params.name, type: params.type, ownerId: params.ownerId };
    });

    jest.spyOn(ProjectService.prototype, 'listProjects').mockImplementation(async function (userId, filters) {
      return [{ ...mockProject, ownerId: userId, ...(filters.status && { status: filters.status }) }];
    });

    jest.spyOn(ProjectService.prototype, 'getProject').mockImplementation(async function (id) {
      if (id === 'not-found') return null;
      return { ...mockProjectDetail, id };
    });

    jest.spyOn(ProjectService.prototype, 'updateProject').mockImplementation(async function (id, data) {
      return { ...mockProject, id, ...data };
    });

    jest.spyOn(ProjectService.prototype, 'deleteProject').mockImplementation(async function (id) {
      return { ...mockProject, id };
    });

    jest.spyOn(ProjectService.prototype, 'addMember').mockImplementation(async function (projectId, userId, role) {
      return { ...mockMember, projectId, userId, role };
    });

    jest.spyOn(ProjectService.prototype, 'getProjectStats').mockImplementation(async function (id) {
      return { ...mockStats, projectId: id };
    });

    const { projectRoutes } = await import('../dist/api/project.js');

    app = Fastify();
    await app.register(projectRoutes);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // --- POST / (create project) ---
  describe('POST /', () => {
    test('creates a project with valid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          name: 'New Building',
          type: 'building',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('New Building');
      expect(body.type).toBe('building');
    });

    test('creates a project with all optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          name: 'Full Project',
          description: 'A detailed project',
          type: 'bridge',
          location: {
            city: 'Shanghai',
            province: 'Shanghai',
            seismicZone: 7,
            windZone: 3,
          },
          settings: {
            designCode: 'GB50010',
            concreteGrade: 'C30',
            steelGrade: 'HRB400',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('Full Project');
      expect(body.type).toBe('bridge');
    });

    test('rejects creation with missing name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          type: 'building',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects creation with empty name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          name: '',
          type: 'building',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects creation with invalid type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          name: 'Bad Type',
          type: 'spaceship',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('rejects creation with missing body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: null,
      });

      expect(response.statusCode).toBe(500);
    });
  });

  // --- GET / (list projects) ---
  describe('GET /', () => {
    test('returns list of projects', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    test('passes status filter to service', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/?status=active',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body[0].status).toBe('active');
    });

    test('passes search filter to service', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/?search=building',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // --- GET /:id (get project detail) ---
  describe('GET /:id', () => {
    test('returns project detail for valid id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/proj-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe('proj-1');
      expect(body.owner).toBeDefined();
    });

    test('returns null for non-existent project', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/not-found',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toBeNull();
    });
  });

  // --- PATCH /:id (update project) ---
  describe('PATCH /:id', () => {
    test('updates project with valid data', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/proj-1',
        payload: { name: 'Updated Building', description: 'Updated desc' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('Updated Building');
      expect(body.description).toBe('Updated desc');
    });

    test('updates project with partial data', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/proj-1',
        payload: { name: 'Only Name Updated' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('Only Name Updated');
    });
  });

  // --- DELETE /:id (delete project) ---
  describe('DELETE /:id', () => {
    test('deletes a project and returns success', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/proj-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
    });
  });

  // --- POST /:id/members (add member) ---
  describe('POST /:id/members', () => {
    test('adds a member to a project', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/proj-1/members',
        payload: { userId: 'user-2', role: 'viewer' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.projectId).toBe('proj-1');
      expect(body.userId).toBe('user-2');
      expect(body.role).toBe('viewer');
    });

    test('adds a member with editor role', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/proj-1/members',
        payload: { userId: 'user-3', role: 'editor' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role).toBe('editor');
    });
  });

  // --- GET /:id/stats (project stats) ---
  describe('GET /:id/stats', () => {
    test('returns project statistics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/proj-1/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.projectId).toBe('proj-1');
      expect(body.members).toBe(2);
      expect(body.models).toBe(5);
      expect(body.analyses).toBe(10);
      expect(body.skills).toBe(3);
    });
  });
});
