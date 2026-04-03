import { describe, expect, test } from '@jest/globals';
import { resolveLocale } from '../dist/services/locale.js';

describe('resolveLocale', () => {
  test('returns "zh" when locale is exactly "zh"', () => {
    expect(resolveLocale('zh')).toBe('zh');
  });

  test('returns "en" when locale is exactly "en"', () => {
    expect(resolveLocale('en')).toBe('en');
  });

  test('returns "en" as default for undefined input', () => {
    expect(resolveLocale(undefined)).toBe('en');
  });

  test('returns "en" as default for null input', () => {
    expect(resolveLocale(null)).toBe('en');
  });

  test('returns "en" as default for numeric input', () => {
    expect(resolveLocale(123)).toBe('en');
  });

  test('returns "en" as default for object input', () => {
    expect(resolveLocale({})).toBe('en');
  });

  test('returns "en" as default for empty string', () => {
    expect(resolveLocale('')).toBe('en');
  });

  test('returns "en" for uppercase "ZH"', () => {
    expect(resolveLocale('ZH')).toBe('en');
  });

  test('returns "en" for partial match "zh-CN"', () => {
    expect(resolveLocale('zh-CN')).toBe('en');
  });

  test('returns "en" for random string', () => {
    expect(resolveLocale('fr')).toBe('en');
  });

  test('returns "en" for boolean true', () => {
    expect(resolveLocale(true)).toBe('en');
  });

  test('returns "en" for boolean false', () => {
    expect(resolveLocale(false)).toBe('en');
  });
});
