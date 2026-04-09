import { prisma } from '../utils/database.js';
import type { InputJsonValue } from '../utils/json.js';
import { ensureUserId } from '../utils/demo-data.js';

export interface CreateLegacySkillCatalogItemParams {
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  authorId?: string;
  tags: string[];
  config: {
    triggers: string[];
    parameters?: any;
    handler: string;
  };
  isPublic: boolean;
}

type LegacySkillCatalogItemWithTagItems = {
  tagItems?: Array<{ value: string }> | null;
} & Record<string, unknown>;

// Legacy marketplace/catalog seed entries.
const LEGACY_CATALOG_BUILTIN_SKILLS = [
  {
    id: 'skill-beam-design',
    name: '梁截面设计',
    description: '根据弯矩和剪力设计混凝土梁截面',
    category: 'design',
    tags: ['混凝土', '梁', '截面设计'],
    config: {
      triggers: ['设计梁', '梁截面', 'beam design'],
      parameters: {
        M: { type: 'number', description: '弯矩设计值 (kN·m)' },
        V: { type: 'number', description: '剪力设计值 (kN)' },
        b: { type: 'number', description: '截面宽度 (mm)' },
        h: { type: 'number', description: '截面高度 (mm)' },
        concreteGrade: { type: 'string', description: '混凝土强度等级' },
      },
    },
  },
  {
    id: 'skill-column-design',
    name: '柱截面设计',
    description: '根据轴力和弯矩设计混凝土柱截面',
    category: 'design',
    tags: ['混凝土', '柱', '截面设计'],
    config: {
      triggers: ['设计柱', '柱截面', 'column design'],
      parameters: {
        N: { type: 'number', description: '轴力设计值 (kN)' },
        Mx: { type: 'number', description: 'x方向弯矩 (kN·m)' },
        My: { type: 'number', description: 'y方向弯矩 (kN·m)' },
        b: { type: 'number', description: '截面宽度 (mm)' },
        h: { type: 'number', description: '截面高度 (mm)' },
      },
    },
  },
  {
    id: 'skill-load-calculation',
    name: '荷载计算',
    description: '计算楼面恒载和活载',
    category: 'analysis',
    tags: ['荷载', '恒载', '活载'],
    config: {
      triggers: ['计算荷载', '荷载计算', 'load calculation'],
      parameters: {
        area: { type: 'number', description: '面积 (m²)' },
        type: { type: 'string', enum: ['floor', 'roof', 'corridor'] },
      },
    },
  },
  {
    id: 'skill-seismic-load',
    name: '地震作用计算',
    description: '计算结构地震作用',
    category: 'analysis',
    tags: ['地震', '抗震', '底部剪力法'],
    config: {
      triggers: ['计算地震', '地震作用', 'seismic load'],
      parameters: {
        totalWeight: { type: 'number', description: '结构总重力荷载代表值 (kN)' },
        seismicZone: { type: 'number', description: '抗震设防烈度' },
        siteClass: { type: 'string', description: '场地类别' },
        dampingRatio: { type: 'number', description: '阻尼比' },
      },
    },
  },
];

function mapCatalogTags<T extends LegacySkillCatalogItemWithTagItems | null>(skill: T) {
  if (!skill) {
    return null;
  }

  const { tagItems, ...rest } = skill;
  return {
    ...rest,
    tags: (tagItems || []).map((item) => item.value),
  };
}

export class LegacySkillCatalogService {
  // List legacy catalog items.
  async listCatalogSkills(params: { category?: string; search?: string }) {
    const where: any = { isPublic: true };

    if (params.category) {
      where.category = params.category;
    }

    if (params.search) {
      where.OR = [
        { name: { contains: params.search } },
        { description: { contains: params.search } },
        { tagItems: { some: { value: { contains: params.search } } } },
      ];
    }

    const catalogItems = await prisma.skill.findMany({
      where,
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [
        { installs: 'desc' },
        { rating: 'desc' },
      ],
      take: 100,
    });

    return catalogItems.map((catalogItem: LegacySkillCatalogItemWithTagItems) => mapCatalogTags(catalogItem));
  }

  // Get a legacy catalog item by id.
  async getCatalogSkill(id: string) {
    const catalogItem = await prisma.skill.findUnique({
      where: { id },
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
        authorUser: {
          select: { id: true, name: true, avatar: true },
        },
        reviews: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return mapCatalogTags(catalogItem);
  }

  // Create a legacy catalog item.
  async createCatalogSkill(params: CreateLegacySkillCatalogItemParams) {
    const catalogItem = await prisma.skill.create({
      data: {
        name: params.name,
        description: params.description,
        category: params.category,
        version: params.version,
        author: params.author,
        authorId: params.authorId,
        tagItems: {
          create: params.tags.map((value) => ({ value })),
        },
        config: params.config,
        isPublic: params.isPublic,
      },
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return mapCatalogTags(catalogItem);
  }

  // Install a legacy catalog item into a project.
  async installCatalogSkill(skillId: string, projectId: string, _userId?: string) {
    // Check whether the item is already installed.
    const existing = await prisma.projectSkill.findFirst({
      where: { skillId, projectId },
    });

    if (existing) {
      return { success: true, message: '技能已安装' };
    }

    // Persist the project-item link.
    await prisma.projectSkill.create({
      data: { skillId, projectId },
    });

    // Update install count.
    await prisma.skill.update({
      where: { id: skillId },
      data: { installs: { increment: 1 } },
    });

    return { success: true, message: '技能安装成功' };
  }

  // Invoke a legacy catalog item handler.
  async invokeCatalogSkill(skillId: string, params: Record<string, unknown>, userId?: string) {
    const catalogItem = await prisma.skill.findUnique({
      where: { id: skillId },
    });

    if (!catalogItem) {
      throw new Error('技能不存在');
    }

    const catalogConfig = catalogItem.config as { handler?: string } | null;
    if (!catalogConfig?.handler) {
      throw new Error('技能配置无效');
    }

    // Record execution.
    await prisma.skillExecution.create({
      data: {
        skillId,
        userId,
        parameters: params as InputJsonValue,
      },
    });

    // Dispatch through the catalog handler registry.
    const result = await this.runCatalogHandler(catalogConfig.handler, params);

    return result;
  }

  // Rate a legacy catalog item.
  async rateCatalogSkill(skillId: string, userId: string | undefined, rating: number, comment?: string) {
    const resolvedUserId = await ensureUserId(userId);

    const review = await prisma.skillReview.upsert({
      where: {
        skillId_userId: { skillId, userId: resolvedUserId },
      },
      create: {
        skillId,
        userId: resolvedUserId,
        rating,
        comment,
      },
      update: {
        rating,
        comment,
      },
    });

    // Update the aggregate rating.
    const avgRating = await prisma.skillReview.aggregate({
      where: { skillId },
      _avg: { rating: true },
    });

    await prisma.skill.update({
      where: { id: skillId },
      data: { rating: avgRating._avg.rating || 0 },
    });

    return review;
  }

  // Get bundled legacy catalog seeds.
  getBuiltinCatalogSkills() {
    return LEGACY_CATALOG_BUILTIN_SKILLS;
  }

  // Execute a catalog handler.
  private async runCatalogHandler(handler: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Dispatch by handler name.
    switch (handler) {
      case 'beam-design':
        return this.handleBeamDesign(params);
      case 'column-design':
        return this.handleColumnDesign(params);
      case 'load-calculation':
        return this.handleLoadCalculation(params);
      case 'seismic-load':
        return this.handleSeismicLoad(params);
      default:
        throw new Error(`未知的技能处理器: ${handler}`);
    }
  }

  // Beam design handler.
  private async handleBeamDesign(params: Record<string, unknown>) {
    // Simplified beam design calculation.
    const M = Number(params.M);
    const h = Number(params.h);
    const h0 = h - 40;

    // Simplified calculation: As = M / (fy * γs * h0).
    const fy = 360; // HRB400钢筋
    const γs = 0.9;
    const As = (M * 1e6) / (fy * γs * h0);

    return {
      requiredSteelArea: As.toFixed(0) + ' mm²',
      recommendation: As > 0 ? `建议配置 ${Math.ceil(As / 314)} 根 HRB400 直径20mm 钢筋` : '配筋满足要求',
    };
  }

  // Column design handler.
  private async handleColumnDesign(params: Record<string, unknown>) {
    const N = Number(params.N);
    const b = Number(params.b);
    const h = Number(params.h);
    const concreteGrade = String(params.concreteGrade ?? 'C30');
    const fcd = this.getConcreteStrength(concreteGrade);

    // Simplified axial compression calculation.
    const Ac = b * h;
    const Ncapacity = 0.9 * (fcd * Ac) / 1000; // kN

    return {
      capacity: Ncapacity.toFixed(0) + ' kN',
      ratio: (N / Ncapacity).toFixed(2),
      status: N < Ncapacity ? '满足要求' : '需要增大截面',
    };
  }

  // Load calculation handler.
  private async handleLoadCalculation(params: Record<string, unknown>) {
    const area = Number(params.area);
    const type = String(params.type ?? 'floor');
    let deadLoad = 0;
    let liveLoad = 0;

    switch (type) {
      case 'floor':
        deadLoad = 3.0; // kN/m²
        liveLoad = 2.0;
        break;
      case 'roof':
        deadLoad = 4.0;
        liveLoad = 0.5;
        break;
      case 'corridor':
        deadLoad = 3.0;
        liveLoad = 2.5;
        break;
    }

    return {
      deadLoad: (deadLoad * area).toFixed(2) + ' kN',
      liveLoad: (liveLoad * area).toFixed(2) + ' kN',
      total: ((deadLoad + liveLoad) * area).toFixed(2) + ' kN',
    };
  }

  // Seismic load handler.
  private async handleSeismicLoad(params: Record<string, unknown>) {
    const totalWeight = Number(params.totalWeight);
    const seismicZone = Number(params.seismicZone);
    const siteClass = String(params.siteClass ?? 'II');

    // Simplified base shear method.
    const αmax = [0.04, 0.08, 0.16, 0.24, 0.32][seismicZone - 6] || 0.16;
    const FEk = αmax * totalWeight;

    return {
      seismicCoefficient: αmax,
      baseShear: FEk.toFixed(2) + ' kN',
      recommendation: `根据抗震设防烈度${seismicZone}度，场地${siteClass}类计算`,
    };
  }

  // Resolve concrete strength.
  private getConcreteStrength(grade: string): number {
    const strengths: Record<string, number> = {
      'C20': 9.6,
      'C25': 11.9,
      'C30': 14.3,
      'C35': 16.7,
      'C40': 19.1,
      'C45': 21.1,
      'C50': 23.1,
      'C55': 25.3,
      'C60': 27.5,
    };
    return strengths[grade] || 14.3;
  }
}
