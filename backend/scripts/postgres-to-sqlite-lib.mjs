function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values ?? []) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function stableId(prefix, parentId, index) {
  return `${prefix}-${parentId}-${index + 1}`;
}

export function buildUserExpertiseRows(users, explicitRows = []) {
  if (explicitRows.length > 0) {
    return explicitRows.map((row, index) => ({
      id: row.id || stableId('user-expertise', row.userId, index),
      userId: row.userId,
      value: row.value,
      position: row.position ?? index,
      createdAt: row.createdAt ?? new Date(),
    }));
  }

  return users.flatMap((user) => uniqueStrings(user.expertise).map((value, index) => ({
    id: stableId('legacy-user-expertise', user.id, index),
    userId: user.id,
    value,
    position: index,
    createdAt: user.createdAt ?? new Date(),
  })));
}

export function buildSkillTagRows(skills, explicitRows = []) {
  if (explicitRows.length > 0) {
    return explicitRows.map((row, index) => ({
      id: row.id || stableId('skill-tag', row.skillId, index),
      skillId: row.skillId,
      value: row.value,
      createdAt: row.createdAt ?? new Date(),
    }));
  }

  return skills.flatMap((skill) => uniqueStrings(skill.tags).map((value, index) => ({
    id: stableId('legacy-skill-tag', skill.id, index),
    skillId: skill.id,
    value,
    createdAt: skill.createdAt ?? new Date(),
  })));
}

export function buildPostTagRows(posts, explicitRows = []) {
  if (explicitRows.length > 0) {
    return explicitRows.map((row, index) => ({
      id: row.id || stableId('post-tag', row.postId, index),
      postId: row.postId,
      value: row.value,
      createdAt: row.createdAt ?? new Date(),
    }));
  }

  return posts.flatMap((post) => uniqueStrings(post.tags).map((value, index) => ({
    id: stableId('legacy-post-tag', post.id, index),
    postId: post.id,
    value,
    createdAt: post.createdAt ?? new Date(),
  })));
}

export function buildPostAttachmentRows(posts, explicitRows = []) {
  if (explicitRows.length > 0) {
    return explicitRows.map((row, index) => ({
      id: row.id || stableId('post-attachment', row.postId, index),
      postId: row.postId,
      url: row.url,
      position: row.position ?? index,
      createdAt: row.createdAt ?? new Date(),
    }));
  }

  return posts.flatMap((post) => uniqueStrings(post.attachments).map((url, index) => ({
    id: stableId('legacy-post-attachment', post.id, index),
    postId: post.id,
    url,
    position: index,
    createdAt: post.createdAt ?? new Date(),
  })));
}

export function stripLegacyScalarLists(source) {
  return {
    ...source,
    users: source.users.map(({ expertise, ...user }) => user),
    skills: source.skills.map(({ tags, ...skill }) => skill),
    posts: source.posts.map(({ tags, attachments, ...post }) => post),
  };
}
