import type { MessageKey } from '@/lib/i18n'
import type { SkillSchemaValidator } from './types'

export function defineValidator<TData>(
  check: (raw: unknown) => raw is TData,
  reasonKey: MessageKey = 'visualizationViewModel'
): SkillSchemaValidator<TData> {
  return (raw) => (check(raw) ? { ok: true, data: raw } : { ok: false, reasonKey })
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

export function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isPlainObject(value)) return false
  return Object.values(value).every(isFiniteNumber)
}
