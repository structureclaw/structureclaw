import { beforeEach, describe, expect, test, jest } from '@jest/globals';
import { prisma } from '../dist/utils/database.js';

jest.unstable_mockModule('../dist/utils/demo-data.js', () => ({
  ensureUserId: jest.fn(),
}));

const { ensureUserId } = await import('../dist/utils/demo-data.js');
const { LegacySkillCatalogService } = await import('../dist/services/skill.js');

describe('LegacySkillCatalogService', () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LegacySkillCatalogService();
  });

  // ---------------------------------------------------------------------------
  // listSkills
  // ---------------------------------------------------------------------------
  describe('listSkills', () => {
    test('returns mapped skills with tags from tagItems', async () => {
      const raw = [
        {
          id: 's1',
          name: 'Beam Design',
          description: 'desc',
          category: 'design',
          tagItems: [{ value: 'concrete' }, { value: 'beam' }],
        },
      ];
      prisma.skill.findMany = jest.fn().mockResolvedValue(raw);

      const result = await svc.listCatalogSkills({});

      expect(result).toEqual([
        {
          id: 's1',
          name: 'Beam Design',
          description: 'desc',
          category: 'design',
          tags: ['concrete', 'beam'],
        },
      ]);
    });

    test('filters by category', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.listCatalogSkills({ category: 'analysis' });

      const where = prisma.skill.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('analysis');
      expect(where.isPublic).toBe(true);
    });

    test('filters by search term with OR conditions', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.listCatalogSkills({ search: 'seismic' });

      const where = prisma.skill.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { name: { contains: 'seismic' } },
        { description: { contains: 'seismic' } },
        { tagItems: { some: { value: { contains: 'seismic' } } } },
      ]);
    });

    test('applies both category and search filters together', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.listCatalogSkills({ category: 'design', search: 'beam' });

      const where = prisma.skill.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('design');
      expect(where.OR).toBeDefined();
      expect(where.isPublic).toBe(true);
    });

    test('defaults isPublic true when no params provided', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.listCatalogSkills({});

      const where = prisma.skill.findMany.mock.calls[0][0].where;
      expect(where.isPublic).toBe(true);
    });

    test('orders by installs desc then rating desc', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.listCatalogSkills({});

      const call = prisma.skill.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual([{ installs: 'desc' }, { rating: 'desc' }]);
    });

    test('limits results to 100', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.listCatalogSkills({});

      const call = prisma.skill.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
    });

    test('returns empty array when no skills found', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.listCatalogSkills({ category: 'nonexistent' });

      expect(result).toEqual([]);
    });

    test('maps skills with null tagItems to empty tags array', async () => {
      const raw = [{ id: 's1', name: 'NoTags', tagItems: null }];
      prisma.skill.findMany = jest.fn().mockResolvedValue(raw);

      const result = await svc.listCatalogSkills({});

      expect(result[0].tags).toEqual([]);
    });

    test('maps skills with undefined tagItems to empty tags array', async () => {
      const raw = [{ id: 's1', name: 'NoTags' }];
      prisma.skill.findMany = jest.fn().mockResolvedValue(raw);

      const result = await svc.listCatalogSkills({});

      expect(result[0].tags).toEqual([]);
    });

    test('includes tagItems with value select and ordering', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.listCatalogSkills({});

      const call = prisma.skill.findMany.mock.calls[0][0];
      expect(call.include).toEqual({
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getSkill
  // ---------------------------------------------------------------------------
  describe('getSkill', () => {
    test('returns mapped skill with tags, author, and reviews', async () => {
      const raw = {
        id: 's1',
        name: 'Beam',
        tagItems: [{ value: 'concrete' }],
        authorUser: { id: 'u1', name: 'Alice', avatar: 'a.png' },
        reviews: [{ id: 'r1', rating: 5 }],
      };
      prisma.skill.findUnique = jest.fn().mockResolvedValue(raw);

      const result = await svc.getCatalogSkill('s1');

      expect(result).toEqual({
        id: 's1',
        name: 'Beam',
        tags: ['concrete'],
        authorUser: { id: 'u1', name: 'Alice', avatar: 'a.png' },
        reviews: [{ id: 'r1', rating: 5 }],
      });
    });

    test('returns null when skill not found', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue(null);

      const result = await svc.getCatalogSkill('nonexistent');

      expect(result).toBeNull();
    });

    test('includes tagItems, authorUser, and reviews relations', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getCatalogSkill('s1');

      const call = prisma.skill.findUnique.mock.calls[0][0];
      expect(call.include.tagItems).toBeDefined();
      expect(call.include.authorUser).toEqual({
        select: { id: true, name: true, avatar: true },
      });
      expect(call.include.reviews).toEqual({
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });

    test('maps skill with null tagItems to empty tags', async () => {
      const raw = { id: 's1', name: 'Test', tagItems: null };
      prisma.skill.findUnique = jest.fn().mockResolvedValue(raw);

      const result = await svc.getCatalogSkill('s1');

      expect(result.tags).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // createSkill
  // ---------------------------------------------------------------------------
  describe('createSkill', () => {
    const baseParams = {
      name: 'My Skill',
      description: 'A test skill',
      category: 'design',
      version: '1.0.0',
      author: 'Tester',
      authorId: 'user-1',
      tags: ['steel', 'beam'],
      config: {
        triggers: ['test'],
        handler: 'beam-design',
      },
      isPublic: true,
    };

    test('creates a skill with tags and returns mapped result', async () => {
      const created = {
        id: 's-new',
        name: 'My Skill',
        tagItems: [{ value: 'steel' }, { value: 'beam' }],
      };
      prisma.skill.create = jest.fn().mockResolvedValue(created);

      const result = await svc.createCatalogSkill(baseParams);

      expect(result).toEqual({
        id: 's-new',
        name: 'My Skill',
        tags: ['steel', 'beam'],
      });
      expect(prisma.skill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'My Skill',
            tagItems: {
              create: [{ value: 'steel' }, { value: 'beam' }],
            },
          }),
        }),
      );
    });

    test('creates skill with empty tags array', async () => {
      const created = { id: 's-empty', name: 'Empty', tagItems: [] };
      prisma.skill.create = jest.fn().mockResolvedValue(created);

      const result = await svc.createCatalogSkill({ ...baseParams, tags: [] });

      expect(result.tags).toEqual([]);
      const call = prisma.skill.create.mock.calls[0][0];
      expect(call.data.tagItems.create).toEqual([]);
    });

    test('includes all provided fields in create data', async () => {
      prisma.skill.create = jest.fn().mockResolvedValue({ id: 's1', tagItems: [] });

      await svc.createCatalogSkill(baseParams);

      const data = prisma.skill.create.mock.calls[0][0].data;
      expect(data.description).toBe('A test skill');
      expect(data.category).toBe('design');
      expect(data.version).toBe('1.0.0');
      expect(data.author).toBe('Tester');
      expect(data.authorId).toBe('user-1');
      expect(data.config).toEqual({ triggers: ['test'], handler: 'beam-design' });
      expect(data.isPublic).toBe(true);
    });

    test('propagates error when prisma create fails', async () => {
      prisma.skill.create = jest.fn().mockRejectedValue(new Error('db write error'));

      await expect(svc.createCatalogSkill(baseParams)).rejects.toThrow('db write error');
    });
  });

  // ---------------------------------------------------------------------------
  // installSkill
  // ---------------------------------------------------------------------------
  describe('installSkill', () => {
    test('returns early when skill is already installed', async () => {
      prisma.projectSkill.findFirst = jest.fn().mockResolvedValue({ id: 'ps-1' });
      prisma.projectSkill.create = jest.fn();
      prisma.skill.update = jest.fn();

      const result = await svc.installCatalogSkill('skill-1', 'proj-1', 'user-1');

      expect(result).toEqual({ success: true, message: '技能已安装' });
      expect(prisma.projectSkill.create).not.toHaveBeenCalled();
      expect(prisma.skill.update).not.toHaveBeenCalled();
    });

    test('installs skill and increments install count', async () => {
      prisma.projectSkill.findFirst = jest.fn().mockResolvedValue(null);
      prisma.projectSkill.create = jest.fn().mockResolvedValue({ id: 'ps-new' });
      prisma.skill.update = jest.fn().mockResolvedValue({});

      const result = await svc.installCatalogSkill('skill-1', 'proj-1', 'user-1');

      expect(result).toEqual({ success: true, message: '技能安装成功' });
      expect(prisma.projectSkill.create).toHaveBeenCalledWith({
        data: { skillId: 'skill-1', projectId: 'proj-1' },
      });
      expect(prisma.skill.update).toHaveBeenCalledWith({
        where: { id: 'skill-1' },
        data: { installs: { increment: 1 } },
      });
    });

    test('installs skill without userId', async () => {
      prisma.projectSkill.findFirst = jest.fn().mockResolvedValue(null);
      prisma.projectSkill.create = jest.fn().mockResolvedValue({ id: 'ps-new' });
      prisma.skill.update = jest.fn().mockResolvedValue({});

      const result = await svc.installCatalogSkill('skill-1', 'proj-1');

      expect(result.success).toBe(true);
    });

    test('propagates error when findFirst fails', async () => {
      prisma.projectSkill.findFirst = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(svc.installCatalogSkill('skill-1', 'proj-1')).rejects.toThrow('db error');
    });
  });

  // ---------------------------------------------------------------------------
  // invokeSkill
  // ---------------------------------------------------------------------------
  describe('invokeSkill', () => {
    test('throws when skill does not exist', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue(null);

      await expect(svc.invokeCatalogSkill('nonexistent', {})).rejects.toThrow('技能不存在');
    });

    test('throws when skill config has no handler', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { triggers: ['test'] },
      });

      await expect(svc.invokeCatalogSkill('s1', {})).rejects.toThrow('技能配置无效');
    });

    test('throws when skill config is null', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: null,
      });

      await expect(svc.invokeCatalogSkill('s1', {})).rejects.toThrow('技能配置无效');
    });

    test('records execution and returns handler result for beam-design', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { handler: 'beam-design' },
      });
      prisma.skillExecution.create = jest.fn().mockResolvedValue({ id: 'exec-1' });

      const result = await svc.invokeCatalogSkill('s1', { M: 100, h: 500 }, 'user-1');

      expect(prisma.skillExecution.create).toHaveBeenCalledWith({
        data: {
          skillId: 's1',
          userId: 'user-1',
          parameters: { M: 100, h: 500 },
        },
      });
      expect(result.requiredSteelArea).toBeDefined();
      expect(result.recommendation).toBeDefined();
    });

    test('records execution without userId', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { handler: 'beam-design' },
      });
      prisma.skillExecution.create = jest.fn().mockResolvedValue({ id: 'exec-1' });

      await svc.invokeCatalogSkill('s1', { M: 50, h: 400 });

      expect(prisma.skillExecution.create).toHaveBeenCalledWith({
        data: {
          skillId: 's1',
          userId: undefined,
          parameters: { M: 50, h: 400 },
        },
      });
    });

    test('throws for unknown handler', async () => {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { handler: 'unknown-handler' },
      });
      prisma.skillExecution.create = jest.fn().mockResolvedValue({});

      await expect(
        svc.invokeCatalogSkill('s1', {}),
      ).rejects.toThrow('未知的技能处理器: unknown-handler');
    });
  });

  // ---------------------------------------------------------------------------
  // rateSkill
  // ---------------------------------------------------------------------------
  describe('rateSkill', () => {
    test('creates a new review and updates average rating', async () => {
      ensureUserId.mockResolvedValue('user-1');
      const review = { id: 'rev-1', skillId: 's1', userId: 'user-1', rating: 5, comment: 'Great' };
      prisma.skillReview.upsert = jest.fn().mockResolvedValue(review);
      prisma.skillReview.aggregate = jest.fn().mockResolvedValue({ _avg: { rating: 4.5 } });
      prisma.skill.update = jest.fn().mockResolvedValue({});

      const result = await svc.rateCatalogSkill('s1', 'user-1', 5, 'Great');

      expect(result).toEqual(review);
      expect(prisma.skillReview.upsert).toHaveBeenCalledWith({
        where: { skillId_userId: { skillId: 's1', userId: 'user-1' } },
        create: { skillId: 's1', userId: 'user-1', rating: 5, comment: 'Great' },
        update: { rating: 5, comment: 'Great' },
      });
      expect(prisma.skill.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { rating: 4.5 },
      });
    });

    test('resolves userId via ensureUserId when undefined', async () => {
      ensureUserId.mockResolvedValue('demo-user');
      prisma.skillReview.upsert = jest.fn().mockResolvedValue({ id: 'rev-2' });
      prisma.skillReview.aggregate = jest.fn().mockResolvedValue({ _avg: { rating: 3 } });
      prisma.skill.update = jest.fn().mockResolvedValue({});

      await svc.rateCatalogSkill('s1', undefined, 3);

      expect(ensureUserId).toHaveBeenCalledWith(undefined);
      const upsertWhere = prisma.skillReview.upsert.mock.calls[0][0].where;
      expect(upsertWhere.skillId_userId.userId).toBe('demo-user');
    });

    test('updates existing review (upsert update path)', async () => {
      ensureUserId.mockResolvedValue('user-1');
      const updated = { id: 'rev-1', rating: 4, comment: 'Updated' };
      prisma.skillReview.upsert = jest.fn().mockResolvedValue(updated);
      prisma.skillReview.aggregate = jest.fn().mockResolvedValue({ _avg: { rating: 4 } });
      prisma.skill.update = jest.fn().mockResolvedValue({});

      const result = await svc.rateCatalogSkill('s1', 'user-1', 4, 'Updated');

      expect(result.rating).toBe(4);
      const call = prisma.skillReview.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ rating: 4, comment: 'Updated' });
    });

    test('defaults rating to 0 when average is null', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.skillReview.upsert = jest.fn().mockResolvedValue({ id: 'rev-3' });
      prisma.skillReview.aggregate = jest.fn().mockResolvedValue({ _avg: { rating: null } });
      prisma.skill.update = jest.fn().mockResolvedValue({});

      await svc.rateCatalogSkill('s1', 'user-1', 2);

      expect(prisma.skill.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { rating: 0 },
      });
    });

    test('rate without comment (undefined)', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.skillReview.upsert = jest.fn().mockResolvedValue({ id: 'rev-4' });
      prisma.skillReview.aggregate = jest.fn().mockResolvedValue({ _avg: { rating: 5 } });
      prisma.skill.update = jest.fn().mockResolvedValue({});

      await svc.rateCatalogSkill('s1', 'user-1', 5);

      const call = prisma.skillReview.upsert.mock.calls[0][0];
      expect(call.create.comment).toBeUndefined();
      expect(call.update.comment).toBeUndefined();
    });

    test('propagates error when upsert fails', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.skillReview.upsert = jest.fn().mockRejectedValue(new Error('constraint'));

      await expect(svc.rateCatalogSkill('s1', 'user-1', 3)).rejects.toThrow('constraint');
    });
  });

  // ---------------------------------------------------------------------------
  // getBuiltinSkills
  // ---------------------------------------------------------------------------
  describe('getBuiltinSkills', () => {
    test('returns an array of builtin skills', () => {
      const skills = svc.getBuiltinCatalogSkills();

      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBe(4);
    });

    test('each builtin skill has required fields', () => {
      const skills = svc.getBuiltinCatalogSkills();

      for (const skill of skills) {
        expect(skill.id).toBeDefined();
        expect(skill.name).toBeDefined();
        expect(skill.description).toBeDefined();
        expect(skill.category).toBeDefined();
        expect(skill.tags).toBeDefined();
        expect(skill.config).toBeDefined();
        expect(Array.isArray(skill.tags)).toBe(true);
      }
    });

    test('contains known builtin skill ids', () => {
      const skills = svc.getBuiltinCatalogSkills();
      const ids = skills.map((s) => s.id);

      expect(ids).toContain('skill-beam-design');
      expect(ids).toContain('skill-column-design');
      expect(ids).toContain('skill-load-calculation');
      expect(ids).toContain('skill-seismic-load');
    });
  });

  // ---------------------------------------------------------------------------
  // Skill handlers (exercised via invokeSkill)
  // ---------------------------------------------------------------------------
  describe('beam-design handler', () => {
    async function invoke(params) {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { handler: 'beam-design' },
      });
      prisma.skillExecution.create = jest.fn().mockResolvedValue({});
      return svc.invokeCatalogSkill('s1', params);
    }

    test('computes required steel area for typical beam', async () => {
      const result = await invoke({ M: 100, h: 500 });

      expect(result.requiredSteelArea).toMatch(/^\d+ mm²$/);
      expect(result.recommendation).toContain('HRB400');
    });

    test('handles zero moment', async () => {
      const result = await invoke({ M: 0, h: 500 });

      expect(result.recommendation).toBe('配筋满足要求');
    });

    test('handles large moment and height', async () => {
      const result = await invoke({ M: 10000, h: 1200 });

      expect(result.requiredSteelArea).toMatch(/^\d+ mm²$/);
    });
  });

  describe('column-design handler', () => {
    async function invoke(params) {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { handler: 'column-design' },
      });
      prisma.skillExecution.create = jest.fn().mockResolvedValue({});
      return svc.invokeCatalogSkill('s1', params);
    }

    test('computes capacity for typical column', async () => {
      const result = await invoke({ N: 500, b: 400, h: 400 });

      expect(result.capacity).toMatch(/^\d+ kN$/);
      expect(result.ratio).toMatch(/^\d+\.\d{2}$/);
      expect(['满足要求', '需要增大截面']).toContain(result.status);
    });

    test('defaults to C30 when concreteGrade not provided', async () => {
      const result = await invoke({ N: 500, b: 400, h: 400 });

      // C30 fcd = 14.3, capacity = 0.9 * 14.3 * 400 * 400 / 1000 = 2059.2 kN
      expect(result.capacity).toBe('2059 kN');
      expect(result.status).toBe('满足要求');
    });

    test('uses specified concrete grade C50', async () => {
      const result = await invoke({ N: 2000, b: 400, h: 400, concreteGrade: 'C50' });

      // C50 fcd = 23.1, capacity = 0.9 * 23.1 * 400 * 400 / 1000 = 3326.4 kN
      expect(result.capacity).toBe('3326 kN');
    });

    test('falls back to C30 for unknown concrete grade', async () => {
      const result = await invoke({ N: 500, b: 400, h: 400, concreteGrade: 'C99' });

      // Falls back to C30 = 14.3
      expect(result.capacity).toBe('2059 kN');
    });

    test('reports "needs larger section" when N exceeds capacity', async () => {
      const result = await invoke({ N: 50000, b: 200, h: 200 });

      expect(result.status).toBe('需要增大截面');
    });
  });

  describe('load-calculation handler', () => {
    async function invoke(params) {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { handler: 'load-calculation' },
      });
      prisma.skillExecution.create = jest.fn().mockResolvedValue({});
      return svc.invokeCatalogSkill('s1', params);
    }

    test('calculates floor loads', async () => {
      const result = await invoke({ area: 10, type: 'floor' });

      expect(result.deadLoad).toBe('30.00 kN');
      expect(result.liveLoad).toBe('20.00 kN');
      expect(result.total).toBe('50.00 kN');
    });

    test('calculates roof loads', async () => {
      const result = await invoke({ area: 20, type: 'roof' });

      expect(result.deadLoad).toBe('80.00 kN');
      expect(result.liveLoad).toBe('10.00 kN');
      expect(result.total).toBe('90.00 kN');
    });

    test('calculates corridor loads', async () => {
      const result = await invoke({ area: 5, type: 'corridor' });

      expect(result.deadLoad).toBe('15.00 kN');
      expect(result.liveLoad).toBe('12.50 kN');
      expect(result.total).toBe('27.50 kN');
    });

    test('defaults to floor when type not provided', async () => {
      const result = await invoke({ area: 10 });

      expect(result.deadLoad).toBe('30.00 kN');
      expect(result.liveLoad).toBe('20.00 kN');
    });

    test('handles zero area', async () => {
      const result = await invoke({ area: 0, type: 'floor' });

      expect(result.deadLoad).toBe('0.00 kN');
      expect(result.liveLoad).toBe('0.00 kN');
      expect(result.total).toBe('0.00 kN');
    });
  });

  describe('seismic-load handler', () => {
    async function invoke(params) {
      prisma.skill.findUnique = jest.fn().mockResolvedValue({
        id: 's1',
        config: { handler: 'seismic-load' },
      });
      prisma.skillExecution.create = jest.fn().mockResolvedValue({});
      return svc.invokeCatalogSkill('s1', params);
    }

    test('calculates seismic load for zone 8', async () => {
      const result = await invoke({ totalWeight: 10000, seismicZone: 8, siteClass: 'II' });

      // Zone 8 -> index 2 -> 0.16, FEk = 0.16 * 10000 = 1600
      expect(result.seismicCoefficient).toBe(0.16);
      expect(result.baseShear).toBe('1600.00 kN');
      expect(result.recommendation).toContain('8');
      expect(result.recommendation).toContain('II');
    });

    test('calculates seismic load for zone 6', async () => {
      const result = await invoke({ totalWeight: 5000, seismicZone: 6 });

      // Zone 6 -> index 0 -> 0.04, FEk = 0.04 * 5000 = 200
      expect(result.seismicCoefficient).toBe(0.04);
      expect(result.baseShear).toBe('200.00 kN');
    });

    test('calculates seismic load for zone 9', async () => {
      const result = await invoke({ totalWeight: 8000, seismicZone: 9 });

      // Zone 9 -> index 3 -> 0.24, FEk = 0.24 * 8000 = 1920
      expect(result.seismicCoefficient).toBe(0.24);
      expect(result.baseShear).toBe('1920.00 kN');
    });

    test('defaults siteClass to II when not provided', async () => {
      const result = await invoke({ totalWeight: 10000, seismicZone: 7 });

      expect(result.recommendation).toContain('II');
    });

    test('uses default alpha for zone outside range', async () => {
      const result = await invoke({ totalWeight: 10000, seismicZone: 5 });

      // Zone 5 -> index -1 -> undefined || 0.16
      expect(result.seismicCoefficient).toBe(0.16);
    });

    test('uses default alpha for very high zone', async () => {
      const result = await invoke({ totalWeight: 10000, seismicZone: 12 });

      // Zone 12 -> index 6 -> undefined || 0.16
      expect(result.seismicCoefficient).toBe(0.16);
    });
  });
});
