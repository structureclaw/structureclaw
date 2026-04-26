import { describe, expect, test } from '@jest/globals';
import {
  buildPostAttachmentRows,
  buildPostTagRows,
  buildSkillTagRows,
  stripLegacyScalarLists,
} from '../scripts/postgres-to-sqlite-lib.mjs';

describe('postgres to sqlite migration helpers', () => {
  test('buildSkillTagRows preserves explicit normalized rows when source already migrated', () => {
    const createdAt = new Date('2026-03-20T00:00:00.000Z');
    const rows = buildSkillTagRows([], [
      {
        id: 'tag-1',
        skillId: 'skill-1',
        value: 'beam',
        createdAt,
      },
    ]);

    expect(rows).toEqual([
      {
        id: 'tag-1',
        skillId: 'skill-1',
        value: 'beam',
        createdAt,
      },
    ]);
  });

  test('buildPostTagRows and buildPostAttachmentRows convert legacy post arrays', () => {
    const createdAt = new Date('2026-03-20T00:00:00.000Z');
    const posts = [
      {
        id: 'post-1',
        createdAt,
        tags: ['tip', 'tip', 'community'],
        attachments: ['a.png', 'b.png'],
      },
    ];

    expect(buildPostTagRows(posts)).toEqual([
      {
        id: 'legacy-post-tag-post-1-1',
        postId: 'post-1',
        value: 'tip',
        createdAt,
      },
      {
        id: 'legacy-post-tag-post-1-2',
        postId: 'post-1',
        value: 'community',
        createdAt,
      },
    ]);

    expect(buildPostAttachmentRows(posts)).toEqual([
      {
        id: 'legacy-post-attachment-post-1-1',
        postId: 'post-1',
        url: 'a.png',
        position: 0,
        createdAt,
      },
      {
        id: 'legacy-post-attachment-post-1-2',
        postId: 'post-1',
        url: 'b.png',
        position: 1,
        createdAt,
      },
    ]);
  });

  test('stripLegacyScalarLists removes removed project and user collections', () => {
    const sanitized = stripLegacyScalarLists({
      users: [{ id: 'user-1', expertise: ['analysis'] }],
      projects: [{ id: 'project-1' }],
      projectMembers: [{ id: 'member-1' }],
      structuralModels: [{ id: 'model-1', projectId: 'project-1' }],
      conversations: [{ id: 'conv-1', userId: 'user-1' }],
      analyses: [{ id: 'analysis-1', createdBy: 'user-1' }],
    });

    expect(sanitized.users).toBeUndefined();
    expect(sanitized.projects).toBeUndefined();
    expect(sanitized.projectMembers).toBeUndefined();
    expect(sanitized.structuralModels).toEqual([{ id: 'model-1' }]);
    expect(sanitized.conversations).toEqual([{ id: 'conv-1' }]);
    expect(sanitized.analyses).toEqual([{ id: 'analysis-1' }]);
  });
});
