import { describe, expect, test } from '@jest/globals';
import { stripLegacyScalarLists } from '../scripts/postgres-to-sqlite-lib.mjs';

describe('postgres to sqlite migration helpers', () => {
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
