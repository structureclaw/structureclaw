export type AppLocale = 'en' | 'zh';

export function resolveLocale(locale: unknown): AppLocale {
  return locale === 'zh' ? 'zh' : 'en';
}
