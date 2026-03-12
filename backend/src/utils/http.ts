export function shouldBypassProxy(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function buildProxyConfig(url: string): { proxy?: false } {
  return shouldBypassProxy(url) ? { proxy: false } : {};
}
