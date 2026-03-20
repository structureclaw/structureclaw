import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { AppLocale } from "@/lib/stores/slices/preferences"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function toIntlLocale(locale: AppLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US'
}

export function formatNumber(num: number, locale: AppLocale = 'en'): string {
  return new Intl.NumberFormat(toIntlLocale(locale)).format(num)
}

export function formatDate(date: Date | string, locale: AppLocale = 'en'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}
