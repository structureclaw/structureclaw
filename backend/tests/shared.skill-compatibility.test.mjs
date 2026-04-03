import { describe, expect, test } from '@jest/globals';
import {
  parseVersion,
  isVersionGreater,
  evaluateSkillCompatibility,
} from '../dist/skill-shared/loader.js';

describe('parseVersion', () => {
  test('should parse standard semver string', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  test('should strip leading v prefix', () => {
    expect(parseVersion('v2.0.1')).toEqual([2, 0, 1]);
  });

  test('should handle major-only version', () => {
    expect(parseVersion('3')).toEqual([3]);
  });

  test('should handle empty string', () => {
    expect(parseVersion('')).toEqual([]);
  });

  test('should filter out non-numeric parts', () => {
    expect(parseVersion('1.beta.3')).toEqual([1, 3]);
  });
});

describe('isVersionGreater', () => {
  test('should return true when required is greater than current', () => {
    expect(isVersionGreater('2.0.0', '1.0.0')).toBe(true);
  });

  test('should return false when required equals current', () => {
    expect(isVersionGreater('1.0.0', '1.0.0')).toBe(false);
  });

  test('should return false when required is less than current', () => {
    expect(isVersionGreater('0.9.0', '1.0.0')).toBe(false);
  });

  test('should compare minor versions', () => {
    expect(isVersionGreater('1.2.0', '1.1.0')).toBe(true);
    expect(isVersionGreater('1.1.0', '1.2.0')).toBe(false);
  });

  test('should compare patch versions', () => {
    expect(isVersionGreater('1.0.2', '1.0.1')).toBe(true);
    expect(isVersionGreater('1.0.1', '1.0.2')).toBe(false);
  });

  test('should handle different length versions', () => {
    expect(isVersionGreater('1.0.1', '1.0')).toBe(true);
    expect(isVersionGreater('1.0', '1.0.1')).toBe(false);
  });
});

describe('evaluateSkillCompatibility', () => {
  test('should return compatible when both version and api match', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(true);
    expect(result.reasonCodes).toEqual([]);
  });

  test('should return compatible when runtime version exceeds minimum', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      '1.0.0',
      'v1',
    );
    expect(result.compatible).toBe(true);
    expect(result.reasonCodes).toEqual([]);
  });

  test('should detect runtime version incompatibility', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '9.0.0', skillApiVersion: 'v1' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(false);
    expect(result.reasonCodes).toEqual(['runtime_version_incompatible']);
  });

  test('should detect skill api version incompatibility', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '0.1.0', skillApiVersion: 'v2' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(false);
    expect(result.reasonCodes).toEqual(['skill_api_version_incompatible']);
  });

  test('should detect both incompatibilities simultaneously', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '9.0.0', skillApiVersion: 'v2' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(false);
    expect(result.reasonCodes).toEqual([
      'runtime_version_incompatible',
      'skill_api_version_incompatible',
    ]);
  });

  test('should handle v-prefixed runtime version', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: 'v0.1.0', skillApiVersion: 'v1' },
      'v0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(true);
    expect(result.reasonCodes).toEqual([]);
  });
});
