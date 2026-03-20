import { prisma } from '../utils/database.js';
import { ensureUserId, hashPassword } from '../utils/demo-data.js';

interface RegisterParams {
  email: string;
  password: string;
  name: string;
  organization?: string;
  title?: string;
}

interface LoginParams {
  email: string;
  password: string;
}

interface UpdateProfileParams {
  name?: string;
  organization?: string;
  title?: string;
  avatar?: string;
  bio?: string;
  expertise?: string[];
}

type UserWithExpertiseItems = {
  expertiseItems?: Array<{ value: string }> | null;
} & Record<string, unknown>;

function mapUserExpertise<T extends UserWithExpertiseItems | null>(user: T) {
  if (!user) {
    return null;
  }

  const { expertiseItems, ...rest } = user;
  return {
    ...rest,
    expertise: (expertiseItems || []).map((item) => item.value),
  };
}

export class UserService {
  async register(params: RegisterParams) {
    const user = await prisma.user.create({
      data: {
        email: params.email,
        passwordHash: hashPassword(params.password),
        name: params.name,
        organization: params.organization,
        title: params.title,
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

    return {
      user,
      token: `dev-token-${user.id}`,
    };
  }

  async login(params: LoginParams) {
    const user = await prisma.user.findUnique({
      where: { email: params.email },
    });

    if (!user || user.passwordHash !== hashPassword(params.password)) {
      throw new Error('邮箱或密码错误');
    }

    return {
      token: `dev-token-${user.id}`,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        organization: user.organization,
        title: user.title,
      },
    };
  }

  async getUserById(userId?: string) {
    const resolvedUserId = await ensureUserId(userId);
    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        organization: true,
        title: true,
        bio: true,
        expertiseItems: {
          select: { value: true },
          orderBy: { position: 'asc' },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    return mapUserExpertise(user);
  }

  async updateProfile(userId: string | undefined, data: UpdateProfileParams) {
    const resolvedUserId = await ensureUserId(userId);
    const { expertise, ...rest } = data;
    const user = await prisma.user.update({
      where: { id: resolvedUserId },
      data: {
        ...rest,
        ...(expertise
          ? {
              expertiseItems: {
                deleteMany: {},
                create: expertise.map((value, index) => ({
                  value,
                  position: index,
                })),
              },
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        organization: true,
        title: true,
        bio: true,
        expertiseItems: {
          select: { value: true },
          orderBy: { position: 'asc' },
        },
        updatedAt: true,
      },
    });

    return mapUserExpertise(user);
  }

  async getPublicProfile(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatar: true,
        organization: true,
        title: true,
        bio: true,
        expertiseItems: {
          select: { value: true },
          orderBy: { position: 'asc' },
        },
        createdAt: true,
      },
    });

    return mapUserExpertise(user);
  }

  async getUserSkills(id: string) {
    const skills = await prisma.skill.findMany({
      where: { authorId: id },
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return skills.map(({ tagItems, ...skill }: { tagItems: Array<{ value: string }> } & Record<string, unknown>) => ({
      ...skill,
      tags: tagItems.map((item: { value: string }) => item.value),
    }));
  }

  async getUserProjects(id: string) {
    return prisma.project.findMany({
      where: {
        OR: [
          { ownerId: id },
          { members: { some: { userId: id } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }
}
