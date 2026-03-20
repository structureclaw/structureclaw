import { describe, expect, test } from '@jest/globals';
import {
  buildPostAttachmentRows,
  buildPostTagRows,
  buildSkillTagRows,
  buildUserExpertiseRows,
  stripLegacyScalarLists,
} from '../scripts/postgres-to-sqlite-lib.mjs';

describe('postgres to sqlite migration helpers', () => {
  test('buildUserExpertiseRows normalizes legacy arrays into ordered relation rows', () => {
    const createdAt = new Date('2026-03-20T00:00:00.000Z');
    const rows = buildUserExpertiseRows([
      {
        id: 'user-1',
        createdAt,
        expertise: ['analysis', 'analysis', ' design ', '', null],
      },
    ]);

    expect(rows).toEqual([
      {
        id: 'legacy-user-expertise-user-1-1',
        userId: 'user-1',
        value: 'analysis',
        position: 0,
        createdAt,
      },
      {
        id: 'legacy-user-expertise-user-1-2',
        userId: 'user-1',
        value: 'design',
        position: 1,
        createdAt,
      },
    ]);
  });

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

  test('stripLegacyScalarLists removes array columns before sqlite inserts', () => {
    const sanitized = stripLegacyScalarLists({
      users: [{ id: 'user-1', expertise: ['analysis'] }],
      skills: [{ id: 'skill-1', tags: ['beam'] }],
      posts: [{ id: 'post-1', tags: ['tip'], attachments: ['a.png'] }],
      projects: [{ id: 'project-1' }],
      projectMembers: [],
      structuralModels: [],
      analyses: [],
      conversations: [],
      messages: [],
      projectSkills: [],
      skillReviews: [],
      skillExecutions: [],
      comments: [],
      postLikes: [],
      userExpertise: [],
      skillTags: [],
      postTags: [],
      postAttachments: [],
    });

    expect(sanitized.users).toEqual([{ id: 'user-1' }]);
    expect(sanitized.skills).toEqual([{ id: 'skill-1' }]);
    expect(sanitized.posts).toEqual([{ id: 'post-1' }]);
  });
});
