import { prisma } from '../utils/database.js';
import { ensureUserId } from '../utils/demo-data.js';

interface ListPostsParams {
  category?: string;
  tag?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

interface CreatePostParams {
  title: string;
  content: string;
  category: string;
  tags: string[];
  attachments?: string[];
  projectId?: string;
  authorId?: string;
}

interface CreateCommentParams {
  postId: string;
  content: string;
  parentId?: string;
  authorId?: string;
}

type PostWithArrays = {
  tagItems?: Array<{ value: string }> | null;
  attachments?: Array<{ url: string }> | null;
} & Record<string, unknown>;

type SkillWithTagItems = {
  tagItems: Array<{ value: string }>;
} & Record<string, unknown>;

function mapPostArrays<T extends PostWithArrays | null>(post: T) {
  if (!post) {
    return null;
  }

  const { tagItems, attachments, ...rest } = post;
  return {
    ...rest,
    tags: (tagItems || []).map((item) => item.value),
    attachments: (attachments || []).map((item) => item.url),
  };
}

export class CommunityService {
  async listPosts(params: ListPostsParams = {}) {
    const where: Record<string, unknown> = {};

    if (params.category) {
      where.category = params.category;
    }

    if (params.tag) {
      where.tagItems = {
        some: { value: params.tag },
      };
    }

    const orderBy: Array<Record<string, string>> =
      params.sort === 'popular'
        ? [{ likeCount: 'desc' }, { viewCount: 'desc' }]
        : [{ createdAt: 'desc' }];

    const posts = await prisma.post.findMany({
      where,
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          select: { url: true },
          orderBy: { position: 'asc' },
        },
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            comments: true,
            likes: true,
          },
        },
      },
      orderBy,
      skip: ((params.page || 1) - 1) * (params.limit || 20),
      take: params.limit || 20,
    });

    return posts.map((post: PostWithArrays) => mapPostArrays(post));
  }

  async createPost(params: CreatePostParams) {
    const authorId = await ensureUserId(params.authorId);

    const post = await prisma.post.create({
      data: {
        title: params.title,
        content: params.content,
        category: params.category,
        tagItems: {
          create: params.tags.map((value) => ({ value })),
        },
        attachments: {
          create: (params.attachments || []).map((url, index) => ({
            url,
            position: index,
          })),
        },
        projectId: params.projectId,
        authorId,
      },
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          select: { url: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    return mapPostArrays(post);
  }

  async getPost(id: string) {
    await prisma.post.update({
      where: { id },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    }).catch(() => undefined);

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          select: { url: true },
          orderBy: { position: 'asc' },
        },
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
            organization: true,
          },
        },
        comments: {
          where: { parentId: null },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
            replies: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return mapPostArrays(post);
  }

  async likePost(id: string, userId?: string) {
    const resolvedUserId = await ensureUserId(userId);
    const existingLike = await prisma.postLike.findFirst({
      where: {
        postId: id,
        userId: resolvedUserId,
      },
    });

    if (existingLike) {
      return { success: true, liked: true };
    }

    await prisma.postLike.create({
      data: {
        postId: id,
        userId: resolvedUserId,
      },
    });

    await prisma.post.update({
      where: { id },
      data: {
        likeCount: {
          increment: 1,
        },
      },
    });

    return { success: true, liked: true };
  }

  async getComments(postId: string) {
    return prisma.comment.findMany({
      where: { postId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createComment(params: CreateCommentParams) {
    const authorId = await ensureUserId(params.authorId);

    return prisma.comment.create({
      data: {
        postId: params.postId,
        content: params.content,
        parentId: params.parentId,
        authorId,
      },
    });
  }

  async listKnowledge(category?: string) {
    const posts = await prisma.post.findMany({
      where: {
        category: category || {
          in: ['tutorial', 'case-study'],
        },
      },
      include: {
        tagItems: {
          select: { value: true },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          select: { url: true },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return posts.map((post: PostWithArrays) => mapPostArrays(post));
  }

  async getPopularTags() {
    const posts = await prisma.post.findMany({
      select: {
        tagItems: {
          select: { value: true },
        },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    const counts = new Map<string, number>();
    for (const post of posts) {
      for (const tag of post.tagItems) {
        counts.set(tag.value, (counts.get(tag.value) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));
  }

  async search(q: string, type?: string) {
    if (type === 'skills') {
      const skills = await prisma.skill.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { description: { contains: q } },
            { tagItems: { some: { value: { contains: q } } } },
          ],
        },
        include: {
          tagItems: {
            select: { value: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        take: 20,
      });

      return {
        posts: [],
        skills: skills.map((skill: SkillWithTagItems) => ({
          ...skill,
          tags: skill.tagItems.map((item: { value: string }) => item.value),
        })),
      };
    }

    const [posts, skills] = await Promise.all([
      prisma.post.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
            { tagItems: { some: { value: { contains: q } } } },
          ],
        },
        include: {
          tagItems: {
            select: { value: true },
            orderBy: { createdAt: 'asc' },
          },
          attachments: {
            select: { url: true },
            orderBy: { position: 'asc' },
          },
        },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.skill.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { description: { contains: q } },
            { tagItems: { some: { value: { contains: q } } } },
          ],
        },
        include: {
          tagItems: {
            select: { value: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        take: 20,
      }),
    ]);

    return {
      posts: posts.map((post: PostWithArrays) => mapPostArrays(post)),
      skills: skills.map((skill: SkillWithTagItems) => ({
        ...skill,
        tags: skill.tagItems.map((item: { value: string }) => item.value),
      })),
    };
  }
}
