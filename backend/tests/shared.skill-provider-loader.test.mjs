import { describe, expect, test } from '@jest/globals';
import { loadSkillProviders } from '../dist/skill-shared/loader.js';

describe('shared skill provider loader', () => {
  test('should merge providers with builtin-before-skillhub tie breaking', () => {
    const providers = loadSkillProviders({
      priorityOrder: 'desc',
      builtInProviders: [
        { id: 'builtin-a', domain: 'demo', source: 'builtin', priority: 50 },
      ],
      externalProviders: [
        { id: 'skillhub-b', domain: 'demo', source: 'skillhub', priority: 80 },
        { id: 'skillhub-a', domain: 'demo', source: 'skillhub', priority: 50 },
      ],
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      'skillhub-b',
      'builtin-a',
      'skillhub-a',
    ]);
  });

  test('should dedupe by provider id after ordering', () => {
    const providers = loadSkillProviders({
      priorityOrder: 'asc',
      builtInProviders: [
        { id: 'shared-id', domain: 'demo', source: 'builtin', priority: 100, marker: 'builtin' },
      ],
      externalProviders: [
        { id: 'shared-id', domain: 'demo', source: 'skillhub', priority: 90, marker: 'skillhub' },
      ],
    });

    expect(providers).toHaveLength(1);
    expect(providers[0].source).toBe('skillhub');
    expect(providers[0].marker).toBe('skillhub');
  });
});
