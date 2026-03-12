import { describe, expect, test } from '@jest/globals';
import { buildProxyConfig, shouldBypassProxy } from '../dist/utils/http.js';

describe('http proxy config', () => {
  test('should bypass proxy for localhost analysis engine urls', () => {
    expect(shouldBypassProxy('http://localhost:30011')).toBe(true);
    expect(shouldBypassProxy('http://127.0.0.1:30011')).toBe(true);
    expect(buildProxyConfig('http://localhost:30011')).toEqual({ proxy: false });
  });

  test('should not bypass proxy for remote urls', () => {
    expect(shouldBypassProxy('https://api.example.com')).toBe(false);
    expect(buildProxyConfig('https://api.example.com')).toEqual({});
  });
});
