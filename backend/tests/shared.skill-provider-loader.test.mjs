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

  test('should return empty array when called with no arguments', () => {
    const providers = loadSkillProviders();
    expect(providers).toEqual([]);
  });

  test('should return empty array when called with empty options', () => {
    const providers = loadSkillProviders({});
    expect(providers).toEqual([]);
  });

  test('should apply filter callback to exclude providers', () => {
    const providers = loadSkillProviders({
      builtInProviders: [
        { id: 'keep-me', domain: 'demo', source: 'builtin', priority: 50 },
        { id: 'drop-me', domain: 'other', source: 'builtin', priority: 80 },
      ],
      filter: (provider) => provider.domain === 'demo',
    });

    expect(providers.map((provider) => provider.id)).toEqual(['keep-me']);
  });

  test('should apply finalize callback to reorder providers', () => {
    const providers = loadSkillProviders({
      priorityOrder: 'desc',
      builtInProviders: [
        { id: 'alpha', domain: 'demo', source: 'builtin', priority: 90, fallback: false },
        { id: 'beta', domain: 'demo', source: 'builtin', priority: 80, fallback: true },
        { id: 'gamma', domain: 'demo', source: 'builtin', priority: 70, fallback: false },
      ],
      finalize: (sorted) => {
        const primary = sorted.filter((p) => !p.fallback);
        const fallback = sorted.filter((p) => p.fallback);
        return [...primary, ...fallback];
      },
    });

    expect(providers.map((provider) => provider.id)).toEqual(['alpha', 'gamma', 'beta']);
  });

  test('should use desc priority order by default', () => {
    const providers = loadSkillProviders({
      builtInProviders: [
        { id: 'low', domain: 'demo', source: 'builtin', priority: 10 },
        { id: 'high', domain: 'demo', source: 'builtin', priority: 90 },
        { id: 'mid', domain: 'demo', source: 'builtin', priority: 50 },
      ],
    });

    expect(providers.map((provider) => provider.id)).toEqual(['high', 'mid', 'low']);
  });

  test('should dedupe keeping first occurrence in sorted order with desc priority', () => {
    const providers = loadSkillProviders({
      priorityOrder: 'desc',
      builtInProviders: [
        { id: 'dup', domain: 'demo', source: 'builtin', priority: 30, marker: 'builtin-low' },
      ],
      externalProviders: [
        { id: 'dup', domain: 'demo', source: 'skillhub', priority: 80, marker: 'skillhub-high' },
      ],
    });

    expect(providers).toHaveLength(1);
    expect(providers[0].marker).toBe('skillhub-high');
  });

  test('should break ties alphabetically by id when priority and source are equal', () => {
    const providers = loadSkillProviders({
      priorityOrder: 'desc',
      builtInProviders: [
        { id: 'charlie', domain: 'demo', source: 'builtin', priority: 50 },
        { id: 'alpha', domain: 'demo', source: 'builtin', priority: 50 },
        { id: 'bravo', domain: 'demo', source: 'builtin', priority: 50 },
      ],
    });

    expect(providers.map((provider) => provider.id)).toEqual(['alpha', 'bravo', 'charlie']);
  });
});
