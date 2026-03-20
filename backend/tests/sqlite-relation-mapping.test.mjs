import { beforeEach, describe, expect, test } from '@jest/globals';
import { prisma } from '../dist/utils/database.js';
import { UserService } from '../dist/services/user.js';
import { SkillService } from '../dist/services/skill.js';
import { CommunityService } from '../dist/services/community.js';

describe('sqlite relation-backed array mapping', () => {
  beforeEach(() => {
    prisma.user.findUnique = async () => null;
    prisma.skill.findMany = async () => [];
    prisma.skill.create = async ({ data }) => ({
      id: 'skill-1',
      name: data.name,
      description: data.description,
      category: data.category,
      version: data.version,
      author: data.author,
      authorId: data.authorId,
      config: data.config,
      isPublic: data.isPublic,
      rating: 0,
      installs: 0,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      tagItems: (data.tagItems?.create || []).map((item) => ({ value: item.value })),
    });
    prisma.post.create = async ({ data }) => ({
      id: 'post-1',
      title: data.title,
      content: data.content,
      category: data.category,
      projectId: data.projectId,
      authorId: data.authorId,
      viewCount: 0,
      likeCount: 0,
      isPinned: false,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      tagItems: (data.tagItems?.create || []).map((item) => ({ value: item.value })),
      attachments: (data.attachments?.create || []).map((item) => ({ url: item.url })),
    });
  });

  test('should flatten expertise relation rows back into expertise arrays', async () => {
    prisma.user.findUnique = async () => ({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      avatar: null,
      organization: 'Org',
      title: 'Engineer',
      bio: 'bio',
      expertiseItems: [
        { value: 'analysis' },
        { value: 'design' },
      ],
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    });

    const svc = new UserService();
    const result = await svc.getUserById('user-1');

    expect(result.expertise).toEqual(['analysis', 'design']);
    expect('expertiseItems' in result).toBe(false);
  });

  test('should flatten skill tag relation rows back into tags arrays', async () => {
    prisma.skill.findMany = async () => ([
      {
        id: 'skill-1',
        name: 'Beam Design',
        description: 'desc',
        category: 'design',
        version: '0.1.0',
        author: 'StructureClaw',
        config: {},
        isPublic: true,
        rating: 4.5,
        installs: 12,
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        tagItems: [{ value: 'beam' }, { value: 'design' }],
      },
    ]);

    const svc = new SkillService();
    const result = await svc.listSkills({});

    expect(result[0].tags).toEqual(['beam', 'design']);
    expect('tagItems' in result[0]).toBe(false);
  });

  test('should write skill tags through relation rows and still return tags arrays', async () => {
    const svc = new SkillService();
    const result = await svc.createSkill({
      name: 'Beam Design',
      description: 'desc',
      category: 'design',
      version: '0.1.0',
      author: 'StructureClaw',
      authorId: 'user-1',
      tags: ['beam', 'concrete'],
      config: { triggers: ['beam'], handler: 'beam-design' },
      isPublic: true,
    });

    expect(result.tags).toEqual(['beam', 'concrete']);
    expect('tagItems' in result).toBe(false);
  });

  test('should write post tags and attachments through relation rows and still return arrays', async () => {
    const svc = new CommunityService();
    const result = await svc.createPost({
      title: 'Welcome',
      content: 'hello',
      category: 'discussion',
      tags: ['welcome', 'seed'],
      attachments: ['https://example.com/a.txt', 'https://example.com/b.txt'],
      authorId: 'user-1',
    });

    expect(result.tags).toEqual(['welcome', 'seed']);
    expect(result.attachments).toEqual([
      'https://example.com/a.txt',
      'https://example.com/b.txt',
    ]);
    expect('tagItems' in result).toBe(false);
  });
});
