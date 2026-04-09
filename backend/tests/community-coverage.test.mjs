import { beforeEach, describe, expect, test, jest } from '@jest/globals';
import { prisma } from '../dist/utils/database.js';

jest.unstable_mockModule('../dist/utils/demo-data.js', () => ({
  ensureUserId: jest.fn(),
}));

const { ensureUserId } = await import('../dist/utils/demo-data.js');
const { CommunityService } = await import('../dist/services/community.js');

describe('CommunityService', () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CommunityService();
  });

  // ---------------------------------------------------------------------------
  // listPosts
  // ---------------------------------------------------------------------------
  describe('listPosts', () => {
    const baseRawPost = {
      id: 'p1',
      title: 'Test Post',
      content: 'body',
      category: 'discussion',
      tagItems: [{ value: 'steel' }, { value: 'beam' }],
      attachments: [{ url: 'https://example.com/file.pdf' }],
      author: { id: 'u1', name: 'Alice', avatar: 'a.png' },
      _count: { comments: 5, likes: 10 },
    };

    test('returns mapped posts with tags and attachments', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([baseRawPost]);

      const result = await svc.listPosts();

      expect(result).toEqual([
        {
          id: 'p1',
          title: 'Test Post',
          content: 'body',
          category: 'discussion',
          tags: ['steel', 'beam'],
          attachments: ['https://example.com/file.pdf'],
          author: { id: 'u1', name: 'Alice', avatar: 'a.png' },
          _count: { comments: 5, likes: 10 },
        },
      ]);
    });

    test('filters by category', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts({ category: 'tutorial' });

      const where = prisma.post.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('tutorial');
    });

    test('filters by tag using tagItems some', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts({ tag: 'seismic' });

      const where = prisma.post.findMany.mock.calls[0][0].where;
      expect(where.tagItems).toEqual({ some: { value: 'seismic' } });
    });

    test('sorts by popular when sort=popular', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts({ sort: 'popular' });

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual([{ likeCount: 'desc' }, { viewCount: 'desc' }]);
    });

    test('sorts by createdAt desc by default', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts({});

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual([{ createdAt: 'desc' }]);
    });

    test('applies pagination with page and limit', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts({ page: 3, limit: 5 });

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10); // (3 - 1) * 5
      expect(call.take).toBe(5);
    });

    test('defaults to page 1 and limit 20', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts({});

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(20);
    });

    test('returns empty array when no posts found', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.listPosts({ category: 'nonexistent' });

      expect(result).toEqual([]);
    });

    test('maps post with null tagItems and attachments to empty arrays', async () => {
      const rawPost = {
        id: 'p2',
        title: 'Empty',
        tagItems: null,
        attachments: null,
      };
      prisma.post.findMany = jest.fn().mockResolvedValue([rawPost]);

      const result = await svc.listPosts();

      expect(result[0].tags).toEqual([]);
      expect(result[0].attachments).toEqual([]);
    });

    test('maps post with undefined tagItems and attachments to empty arrays', async () => {
      const rawPost = { id: 'p3', title: 'NoFields' };
      prisma.post.findMany = jest.fn().mockResolvedValue([rawPost]);

      const result = await svc.listPosts();

      expect(result[0].tags).toEqual([]);
      expect(result[0].attachments).toEqual([]);
    });

    test('includes author and _count relations', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts();

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.include.author).toEqual({
        select: { id: true, name: true, avatar: true },
      });
      expect(call.include._count).toEqual({
        select: { comments: true, likes: true },
      });
    });

    test('combines category, tag, sort, and pagination filters', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listPosts({ category: 'tutorial', tag: 'steel', sort: 'popular', page: 2, limit: 10 });

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.where.category).toBe('tutorial');
      expect(call.where.tagItems).toEqual({ some: { value: 'steel' } });
      expect(call.orderBy).toEqual([{ likeCount: 'desc' }, { viewCount: 'desc' }]);
      expect(call.skip).toBe(10);
      expect(call.take).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // createPost
  // ---------------------------------------------------------------------------
  describe('createPost', () => {
    const baseParams = {
      title: 'New Post',
      content: 'Content here',
      category: 'discussion',
      tags: ['steel', 'design'],
      attachments: ['https://example.com/img.png'],
      projectId: 'proj-1',
      authorId: 'user-1',
    };

    test('creates a post with tags and attachments, returns mapped', async () => {
      ensureUserId.mockResolvedValue('user-1');
      const created = {
        id: 'p-new',
        title: 'New Post',
        tagItems: [{ value: 'steel' }, { value: 'design' }],
        attachments: [{ url: 'https://example.com/img.png' }],
      };
      prisma.post.create = jest.fn().mockResolvedValue(created);

      const result = await svc.createPost(baseParams);

      expect(result).toEqual({
        id: 'p-new',
        title: 'New Post',
        tags: ['steel', 'design'],
        attachments: ['https://example.com/img.png'],
      });
    });

    test('resolves authorId via ensureUserId when not provided', async () => {
      ensureUserId.mockResolvedValue('demo-user');
      prisma.post.create = jest.fn().mockResolvedValue({ id: 'p2', tagItems: [], attachments: [] });

      await svc.createPost({ ...baseParams, authorId: undefined });

      expect(ensureUserId).toHaveBeenCalledWith(undefined);
      const data = prisma.post.create.mock.calls[0][0].data;
      expect(data.authorId).toBe('demo-user');
    });

    test('creates post with empty tags and no attachments', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.post.create = jest.fn().mockResolvedValue({ id: 'p3', tagItems: [], attachments: [] });

      const result = await svc.createPost({
        title: 'Minimal',
        content: 'Min',
        category: 'discussion',
        tags: [],
      });

      const data = prisma.post.create.mock.calls[0][0].data;
      expect(data.tagItems.create).toEqual([]);
      expect(data.attachments.create).toEqual([]);
      expect(result.tags).toEqual([]);
      expect(result.attachments).toEqual([]);
    });

    test('sets attachment position based on index', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.post.create = jest.fn().mockResolvedValue({ id: 'p4', tagItems: [], attachments: [] });

      await svc.createPost({
        ...baseParams,
        attachments: ['url1', 'url2', 'url3'],
      });

      const data = prisma.post.create.mock.calls[0][0].data;
      expect(data.attachments.create).toEqual([
        { url: 'url1', position: 0 },
        { url: 'url2', position: 1 },
        { url: 'url3', position: 2 },
      ]);
    });

    test('propagates error when prisma create fails', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.post.create = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(svc.createPost(baseParams)).rejects.toThrow('db error');
    });
  });

  // ---------------------------------------------------------------------------
  // getPost
  // ---------------------------------------------------------------------------
  describe('getPost', () => {
    test('returns mapped post with comments and replies', async () => {
      const raw = {
        id: 'p1',
        title: 'Detailed Post',
        tagItems: [{ value: 'test' }],
        attachments: [{ url: 'file.pdf' }],
        author: { id: 'u1', name: 'Bob', avatar: 'b.png', organization: 'Org' },
        comments: [
          {
            id: 'c1',
            content: 'Nice post',
            author: { id: 'u2', name: 'Carol', avatar: 'c.png' },
            replies: [{ id: 'c1r1' }],
          },
        ],
      };
      prisma.post.update = jest.fn().mockResolvedValue({});
      prisma.post.findUnique = jest.fn().mockResolvedValue(raw);

      const result = await svc.getPost('p1');

      expect(result).toEqual({
        id: 'p1',
        title: 'Detailed Post',
        tags: ['test'],
        attachments: ['file.pdf'],
        author: { id: 'u1', name: 'Bob', avatar: 'b.png', organization: 'Org' },
        comments: [
          {
            id: 'c1',
            content: 'Nice post',
            author: { id: 'u2', name: 'Carol', avatar: 'c.png' },
            replies: [{ id: 'c1r1' }],
          },
        ],
      });
    });

    test('increments viewCount on fetch', async () => {
      prisma.post.update = jest.fn().mockResolvedValue({});
      prisma.post.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getPost('p1');

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { viewCount: { increment: 1 } },
      });
    });

    test('returns null when post not found', async () => {
      prisma.post.update = jest.fn().mockResolvedValue({});
      prisma.post.findUnique = jest.fn().mockResolvedValue(null);

      const result = await svc.getPost('nonexistent');

      expect(result).toBeNull();
    });

    test('continues when viewCount update fails', async () => {
      prisma.post.update = jest.fn().mockRejectedValue(new Error('update failed'));
      prisma.post.findUnique = jest.fn().mockResolvedValue({
        id: 'p1',
        tagItems: [],
        attachments: [],
      });

      const result = await svc.getPost('p1');

      // Should still return the post even though update failed
      expect(result.id).toBe('p1');
    });

    test('includes author with organization in findUnique', async () => {
      prisma.post.update = jest.fn().mockResolvedValue({});
      prisma.post.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getPost('p1');

      const call = prisma.post.findUnique.mock.calls[0][0];
      expect(call.include.author.select).toEqual({
        id: true,
        name: true,
        avatar: true,
        organization: true,
      });
    });

    test('includes top-level comments with author and replies', async () => {
      prisma.post.update = jest.fn().mockResolvedValue({});
      prisma.post.findUnique = jest.fn().mockResolvedValue(null);

      await svc.getPost('p1');

      const call = prisma.post.findUnique.mock.calls[0][0];
      const commentsInclude = call.include.comments;
      expect(commentsInclude.where).toEqual({ parentId: null });
      expect(commentsInclude.include.author).toEqual({
        select: { id: true, name: true, avatar: true },
      });
      expect(commentsInclude.include.replies).toBe(true);
      expect(commentsInclude.orderBy).toEqual({ createdAt: 'asc' });
    });
  });

  // ---------------------------------------------------------------------------
  // likePost
  // ---------------------------------------------------------------------------
  describe('likePost', () => {
    test('returns early when user already liked the post', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.postLike.findFirst = jest.fn().mockResolvedValue({ id: 'like-1' });
      prisma.postLike.create = jest.fn();
      prisma.post.update = jest.fn();

      const result = await svc.likePost('p1', 'user-1');

      expect(result).toEqual({ success: true, liked: true });
      expect(prisma.postLike.create).not.toHaveBeenCalled();
      expect(prisma.post.update).not.toHaveBeenCalled();
    });

    test('creates like and increments likeCount', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.postLike.findFirst = jest.fn().mockResolvedValue(null);
      prisma.postLike.create = jest.fn().mockResolvedValue({ id: 'like-new' });
      prisma.post.update = jest.fn().mockResolvedValue({});

      const result = await svc.likePost('p1', 'user-1');

      expect(result).toEqual({ success: true, liked: true });
      expect(prisma.postLike.create).toHaveBeenCalledWith({
        data: { postId: 'p1', userId: 'user-1' },
      });
      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { likeCount: { increment: 1 } },
      });
    });

    test('resolves userId via ensureUserId when not provided', async () => {
      ensureUserId.mockResolvedValue('demo-user');
      prisma.postLike.findFirst = jest.fn().mockResolvedValue(null);
      prisma.postLike.create = jest.fn().mockResolvedValue({});
      prisma.post.update = jest.fn().mockResolvedValue({});

      await svc.likePost('p1');

      expect(ensureUserId).toHaveBeenCalledWith(undefined);
      expect(prisma.postLike.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'demo-user' }) }),
      );
    });

    test('propagates error when findFirst fails', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.postLike.findFirst = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(svc.likePost('p1', 'user-1')).rejects.toThrow('db error');
    });
  });

  // ---------------------------------------------------------------------------
  // getComments
  // ---------------------------------------------------------------------------
  describe('getComments', () => {
    test('returns comments for a post with author info', async () => {
      const comments = [
        { id: 'c1', content: 'First', author: { id: 'u1', name: 'A', avatar: 'a.png' } },
        { id: 'c2', content: 'Second', author: { id: 'u2', name: 'B', avatar: 'b.png' } },
      ];
      prisma.comment.findMany = jest.fn().mockResolvedValue(comments);

      const result = await svc.getComments('p1');

      expect(result).toEqual(comments);
      expect(prisma.comment.findMany).toHaveBeenCalledWith({
        where: { postId: 'p1' },
        include: {
          author: { select: { id: true, name: true, avatar: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    });

    test('returns empty array when no comments', async () => {
      prisma.comment.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.getComments('p-no-comments');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // createComment
  // ---------------------------------------------------------------------------
  describe('createComment', () => {
    test('creates a comment with authorId', async () => {
      ensureUserId.mockResolvedValue('user-1');
      const comment = { id: 'c-new', postId: 'p1', content: 'Reply', authorId: 'user-1' };
      prisma.comment.create = jest.fn().mockResolvedValue(comment);

      const result = await svc.createComment({
        postId: 'p1',
        content: 'Reply',
        authorId: 'user-1',
      });

      expect(result).toEqual(comment);
      expect(prisma.comment.create).toHaveBeenCalledWith({
        data: { postId: 'p1', content: 'Reply', parentId: undefined, authorId: 'user-1' },
      });
    });

    test('creates a nested reply with parentId', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.comment.create = jest.fn().mockResolvedValue({ id: 'c-reply' });

      await svc.createComment({
        postId: 'p1',
        content: 'Nested reply',
        parentId: 'c-parent',
        authorId: 'user-1',
      });

      expect(prisma.comment.create).toHaveBeenCalledWith({
        data: {
          postId: 'p1',
          content: 'Nested reply',
          parentId: 'c-parent',
          authorId: 'user-1',
        },
      });
    });

    test('resolves authorId via ensureUserId when not provided', async () => {
      ensureUserId.mockResolvedValue('demo-user');
      prisma.comment.create = jest.fn().mockResolvedValue({ id: 'c3' });

      await svc.createComment({ postId: 'p1', content: 'Auto', authorId: undefined });

      expect(ensureUserId).toHaveBeenCalledWith(undefined);
      const data = prisma.comment.create.mock.calls[0][0].data;
      expect(data.authorId).toBe('demo-user');
    });

    test('propagates error when create fails', async () => {
      ensureUserId.mockResolvedValue('user-1');
      prisma.comment.create = jest.fn().mockRejectedValue(new Error('constraint'));

      await expect(
        svc.createComment({ postId: 'p1', content: 'Fail', authorId: 'user-1' }),
      ).rejects.toThrow('constraint');
    });
  });

  // ---------------------------------------------------------------------------
  // listKnowledge
  // ---------------------------------------------------------------------------
  describe('listKnowledge', () => {
    test('returns mapped posts limited to 50', async () => {
      const rawPosts = [
        { id: 'k1', tagItems: [{ value: 'tutorial' }], attachments: [] },
        { id: 'k2', tagItems: [], attachments: [{ url: 'doc.pdf' }] },
      ];
      prisma.post.findMany = jest.fn().mockResolvedValue(rawPosts);

      const result = await svc.listKnowledge();

      expect(result).toEqual([
        { id: 'k1', tags: ['tutorial'], attachments: [] },
        { id: 'k2', tags: [], attachments: ['doc.pdf'] },
      ]);
      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.take).toBe(50);
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });

    test('filters by specific category', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listKnowledge('tutorial');

      const where = prisma.post.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('tutorial');
    });

    test('defaults to tutorial and case-study when no category', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.listKnowledge();

      const where = prisma.post.findMany.mock.calls[0][0].where;
      expect(where.category).toEqual({ in: ['tutorial', 'case-study'] });
    });

    test('returns empty array when no knowledge posts', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.listKnowledge();

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getPopularTags
  // ---------------------------------------------------------------------------
  describe('getPopularTags', () => {
    test('returns sorted tag counts limited to 20', async () => {
      const posts = [
        { tagItems: [{ value: 'steel' }, { value: 'beam' }] },
        { tagItems: [{ value: 'steel' }, { value: 'concrete' }] },
        { tagItems: [{ value: 'steel' }] },
      ];
      prisma.post.findMany = jest.fn().mockResolvedValue(posts);

      const result = await svc.getPopularTags();

      expect(result[0]).toEqual({ tag: 'steel', count: 3 });
      expect(result[1]).toEqual({ tag: 'beam', count: 1 });
      expect(result[2]).toEqual({ tag: 'concrete', count: 1 });
    });

    test('queries at most 100 posts ordered by newest', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      await svc.getPopularTags();

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });

    test('returns empty array when no posts exist', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.getPopularTags();

      expect(result).toEqual([]);
    });

    test('handles posts with empty tagItems', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([
        { tagItems: [] },
        { tagItems: [] },
      ]);

      const result = await svc.getPopularTags();

      expect(result).toEqual([]);
    });

    test('sorts tags by count descending', async () => {
      const posts = [
        { tagItems: [{ value: 'a' }] },
        { tagItems: [{ value: 'b' }, { value: 'b-tag' }] },
        { tagItems: [{ value: 'b' }] },
      ];
      prisma.post.findMany = jest.fn().mockResolvedValue(posts);

      const result = await svc.getPopularTags();

      // 'b' appears 2 times, 'a' 1 time, 'b-tag' 1 time
      expect(result[0].tag).toBe('b');
      expect(result[0].count).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------
  describe('search', () => {
    test('searches only skills when type=skills', async () => {
      const skills = [
        { id: 's1', name: 'Beam', tagItems: [{ value: 'steel' }] },
      ];
      prisma.skill.findMany = jest.fn().mockResolvedValue(skills);

      const result = await svc.search('beam', 'skills');

      expect(result.posts).toEqual([]);
      expect(result.skills).toEqual([
        { id: 's1', name: 'Beam', tagItems: [{ value: 'steel' }], tags: ['steel'] },
      ]);
      expect(prisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: 'beam' } },
              { description: { contains: 'beam' } },
              { tagItems: { some: { value: { contains: 'beam' } } } },
            ],
          },
          take: 20,
        }),
      );
    });

    test('searches both posts and skills when type is not skills', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([
        { id: 'p1', title: 'Seismic Design', tagItems: [{ value: 'seismic' }], attachments: [] },
      ]);
      prisma.skill.findMany = jest.fn().mockResolvedValue([
        { id: 's1', name: 'Seismic Skill', tagItems: [{ value: 'seismic' }] },
      ]);

      const result = await svc.search('seismic');

      expect(result.posts).toEqual([
        { id: 'p1', title: 'Seismic Design', tags: ['seismic'], attachments: [] },
      ]);
      expect(result.skills).toEqual([
        { id: 's1', name: 'Seismic Skill', tagItems: [{ value: 'seismic' }], tags: ['seismic'] },
      ]);
    });

    test('returns empty results when nothing matches', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      const result = await svc.search('nonexistent');

      expect(result.posts).toEqual([]);
      expect(result.skills).toEqual([]);
    });

    test('limits both posts and skills to 20', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.search('test');

      expect(prisma.post.findMany.mock.calls[0][0].take).toBe(20);
      expect(prisma.skill.findMany.mock.calls[0][0].take).toBe(20);
    });

    test('searches posts by title, content, and tagItems', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.search('wind');

      const where = prisma.post.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { title: { contains: 'wind' } },
        { content: { contains: 'wind' } },
        { tagItems: { some: { value: { contains: 'wind' } } } },
      ]);
    });

    test('orders posts by createdAt desc in combined search', async () => {
      prisma.post.findMany = jest.fn().mockResolvedValue([]);
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);

      await svc.search('test');

      const call = prisma.post.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });

    test('type=skills does not query posts', async () => {
      prisma.skill.findMany = jest.fn().mockResolvedValue([]);
      prisma.post.findMany = jest.fn();

      await svc.search('test', 'skills');

      expect(prisma.post.findMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // mapPostArrays (internal, exercised via public methods)
  // ---------------------------------------------------------------------------
  describe('mapPostArrays edge cases', () => {
    test('getPost returns null when findUnique returns null', async () => {
      prisma.post.update = jest.fn().mockResolvedValue({});
      prisma.post.findUnique = jest.fn().mockResolvedValue(null);

      const result = await svc.getPost('nonexistent');

      expect(result).toBeNull();
    });

    test('getPost maps post with missing tagItems and attachments gracefully', async () => {
      prisma.post.update = jest.fn().mockResolvedValue({});
      prisma.post.findUnique = jest.fn().mockResolvedValue({
        id: 'p1',
        title: 'Raw Post',
      });

      const result = await svc.getPost('p1');

      expect(result.tags).toEqual([]);
      expect(result.attachments).toEqual([]);
    });
  });
});
