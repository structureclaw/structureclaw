import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../.env');
const defaultSqliteDatabasePath = path.resolve(__dirname, '../../.runtime/data/structureclaw.db');

dotenv.config({ path: rootEnvPath, quiet: true });
process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${defaultSqliteDatabasePath}`;

const prisma = new PrismaClient();

async function main() {
  const demoUser = await prisma.user.upsert({
    where: { id: 'seed-user-demo' },
    update: {
      name: 'Demo User',
      organization: 'StructureClaw',
      title: 'Structural Engineer',
      bio: 'Local seeded user for development.',
    },
    create: {
      id: 'seed-user-demo',
      email: 'demo@structureclaw.local',
      name: 'Demo User',
      organization: 'StructureClaw',
      title: 'Structural Engineer',
      bio: 'Local seeded user for development.',
    },
  });

  const demoProject = await prisma.project.upsert({
    where: { id: 'seed-project-demo' },
    update: {
      name: 'Demo Project',
      description: 'Seeded development project.',
      type: 'building',
      location: {
        city: 'Shanghai',
        province: 'Shanghai',
        seismicZone: 8,
        windZone: 2,
      },
      settings: {
        designCode: 'GB50010',
        concreteGrade: 'C30',
      },
      ownerId: demoUser.id,
    },
    create: {
      id: 'seed-project-demo',
      name: 'Demo Project',
      description: 'Seeded development project.',
      type: 'building',
      location: {
        city: 'Shanghai',
        province: 'Shanghai',
        seismicZone: 8,
        windZone: 2,
      },
      settings: {
        designCode: 'GB50010',
        concreteGrade: 'C30',
      },
      ownerId: demoUser.id,
    },
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: demoProject.id,
        userId: demoUser.id,
      },
    },
    update: {
      role: 'owner',
    },
    create: {
      id: 'seed-project-member-demo',
      projectId: demoProject.id,
      userId: demoUser.id,
      role: 'owner',
    },
  });

  const demoModel = await prisma.structuralModel.upsert({
    where: { id: 'seed-model-demo' },
    update: {
      name: 'Three-Story Frame',
      description: 'Seeded structural model for local testing.',
      projectId: demoProject.id,
      createdBy: demoUser.id,
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: 6000, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '3', x: 0, y: 0, z: 3000 },
        { id: '4', x: 6000, y: 0, z: 3000 },
      ],
      elements: [
        { id: '101', type: 'beam', nodes: ['1', '3'], material: 'C30', section: 'COL-500' },
        { id: '102', type: 'beam', nodes: ['2', '4'], material: 'C30', section: 'COL-500' },
        { id: '103', type: 'beam', nodes: ['3', '4'], material: 'C30', section: 'BM-300x600' },
      ],
      materials: [
        { id: 'C30', name: 'Concrete C30', E: 30000, nu: 0.2, rho: 2500, fy: 0 },
      ],
      sections: [
        { id: 'COL-500', name: '500x500 Column', type: 'rect', properties: { A: 0.25, E: 30000000, Iz: 0.0052, Iy: 0.0052, G: 12500000, J: 0.001 } },
        { id: 'BM-300x600', name: '300x600 Beam', type: 'rect', properties: { A: 0.18, E: 30000000, Iz: 0.0054, Iy: 0.00135, G: 12500000, J: 0.0008 } },
      ],
    },
    create: {
      id: 'seed-model-demo',
      name: 'Three-Story Frame',
      description: 'Seeded structural model for local testing.',
      projectId: demoProject.id,
      createdBy: demoUser.id,
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: 6000, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '3', x: 0, y: 0, z: 3000 },
        { id: '4', x: 6000, y: 0, z: 3000 },
      ],
      elements: [
        { id: '101', type: 'beam', nodes: ['1', '3'], material: 'C30', section: 'COL-500' },
        { id: '102', type: 'beam', nodes: ['2', '4'], material: 'C30', section: 'COL-500' },
        { id: '103', type: 'beam', nodes: ['3', '4'], material: 'C30', section: 'BM-300x600' },
      ],
      materials: [
        { id: 'C30', name: 'Concrete C30', E: 30000, nu: 0.2, rho: 2500, fy: 0 },
      ],
      sections: [
        { id: 'COL-500', name: '500x500 Column', type: 'rect', properties: { A: 0.25, E: 30000000, Iz: 0.0052, Iy: 0.0052, G: 12500000, J: 0.001 } },
        { id: 'BM-300x600', name: '300x600 Beam', type: 'rect', properties: { A: 0.18, E: 30000000, Iz: 0.0054, Iy: 0.00135, G: 12500000, J: 0.0008 } },
      ],
    },
  });

  await prisma.analysis.upsert({
    where: { id: 'seed-analysis-demo' },
    update: {
      name: 'Seed Static Analysis',
      type: 'static',
      status: 'completed',
      modelId: demoModel.id,
      createdBy: demoUser.id,
      parameters: {
        loadCases: [
          {
            name: 'DL',
            type: 'dead',
            loads: [],
          },
        ],
      },
      results: {
        status: 'success',
        note: 'Seeded result',
      },
    },
    create: {
      id: 'seed-analysis-demo',
      name: 'Seed Static Analysis',
      type: 'static',
      status: 'completed',
      modelId: demoModel.id,
      createdBy: demoUser.id,
      parameters: {
        loadCases: [
          {
            name: 'DL',
            type: 'dead',
            loads: [],
          },
        ],
      },
      results: {
        status: 'success',
        note: 'Seeded result',
      },
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  console.log('Seed completed.');
  console.log('Demo user: demo@structureclaw.local');
  console.log(`Demo project id: ${demoProject.id}`);
  console.log(`Demo model id: ${demoModel.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
