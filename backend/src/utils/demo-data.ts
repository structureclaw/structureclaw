import { prisma } from './database.js';

const DEMO_USER_EMAIL = 'demo@structureclaw.local';

export async function ensureDemoUser() {
  return prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: {
      email: DEMO_USER_EMAIL,
      name: 'Demo User',
      organization: 'StructureClaw',
      title: 'Demo Engineer',
      bio: 'Automatically created local demo user.',
    },
  });
}

export async function ensureUserId(userId?: string): Promise<string> {
  if (userId) {
    return userId;
  }

  const user = await ensureDemoUser();
  return user.id;
}

export async function ensureProjectId(projectId?: string, ownerId?: string): Promise<string> {
  if (projectId) {
    return projectId;
  }

  const resolvedOwnerId = await ensureUserId(ownerId);
  const existingProject = await prisma.project.findFirst({
    where: { ownerId: resolvedOwnerId },
    orderBy: { createdAt: 'asc' },
  });

  if (existingProject) {
    return existingProject.id;
  }

  const project = await prisma.project.create({
    data: {
      name: 'Demo Project',
      description: 'Automatically created demo project for local startup.',
      type: 'building',
      ownerId: resolvedOwnerId,
      location: {
        city: 'Local',
        province: 'Local',
        seismicZone: 8,
        windZone: 2,
      },
      settings: {
        designCode: 'GB50010',
      },
    },
  });

  return project.id;
}
