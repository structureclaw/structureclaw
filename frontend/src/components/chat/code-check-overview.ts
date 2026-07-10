import type { AppLocale } from '@/lib/stores/slices/preferences'
import { formatNumber } from '@/lib/utils'

export type CodeCheckAttentionItem = {
  elementId: string
  scopeKind: 'element' | 'global'
  check: string
  item?: string
  clause?: string
  utilization: string
  rawStatus: string
  status: string
  message?: string
}

export type CodeCheckOverview = {
  summary?: {
    total: string
    passed: string
    failed: string
    warnings: string
    notApplicable?: string
    status: 'passed' | 'warning' | 'failed'
  }
  governing?: {
    element: string
    check: string
    utilization: string
  }
  attentionItems: CodeCheckAttentionItem[]
}

type CodeCheckOverviewInput = {
  codeCheck?: unknown
  report?: {
    json?: Record<string, unknown>
  }
  result?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeCodeCheckResultPayload(result: CodeCheckOverviewInput | null | undefined): CodeCheckOverviewInput | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const record = result as Record<string, unknown>
  const wrapped = record.result
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    const wrappedRecord = wrapped as Record<string, unknown>
    const hasTopLevelCodeCheck = Boolean(record.codeCheck || record.report)
    const hasWrappedCodeCheck = Boolean(wrappedRecord.codeCheck || wrappedRecord.report)
    if (!hasTopLevelCodeCheck && hasWrappedCodeCheck) {
      return wrappedRecord as CodeCheckOverviewInput
    }
  }

  return result
}

function codeCheckRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : []
}

function codeCheckText(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return fallback
}

function codeCheckDisplayValue(value: unknown, locale: AppLocale, fallback = 'N/A'): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatNumber(value, locale)
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  return fallback
}

function codeCheckScopeValue(value: unknown, locale: AppLocale): { label: string; kind: 'element' | 'global' } {
  const text = codeCheckText(value)
  if (text === '__global_seismic__') {
    return {
      label: locale === 'zh' ? '整体抗震流程' : 'Global seismic workflow',
      kind: 'global',
    }
  }
  if (text === '__global__') {
    return {
      label: locale === 'zh' ? '全局校核' : 'Global check',
      kind: 'global',
    }
  }
  return {
    label: text || 'N/A',
    kind: 'element',
  }
}

function codeCheckUtilizationDisplayValue(
  value: unknown,
  locale: AppLocale,
  item?: Record<string, unknown> | null
): string {
  const displayValue = item?.displayUtilization
  if (typeof displayValue === 'string' && displayValue.trim()) {
    return displayValue.trim()
  }
  if (typeof displayValue === 'number' && Number.isFinite(displayValue)) {
    return formatNumber(displayValue, locale)
  }
  const numeric = codeCheckNumericValue(value)
  if (numeric !== null && Math.abs(numeric) >= 9999) {
    return 'N/A'
  }
  return codeCheckDisplayValue(value, locale)
}

function codeCheckStatusDisplayValue(item: Record<string, unknown>, locale: AppLocale): string {
  const status = codeCheckText(item.status).toLowerCase()
  const category = codeCheckText(item.category).toLowerCase()
  if (status === 'pass' || status === 'passed') return locale === 'zh' ? '通过' : 'Pass'
  if (status === 'warning' || status === 'warn') return locale === 'zh' ? '警告' : 'Warning'
  if (status === 'not_applicable' || status === 'not-applicable' || status === 'n/a') {
    return locale === 'zh' ? '资料不足/不适用' : 'Unavailable/N.A.'
  }
  if (status === 'fail' || status === 'failed') {
    if (category === 'input_required') return locale === 'zh' ? '需补充资料' : 'Needs input'
    if (category === 'diagnostic' || category === 'trace') return locale === 'zh' ? '诊断未通过' : 'Diagnostic fail'
    return locale === 'zh' ? '未通过' : 'Fail'
  }
  return codeCheckText(item.status, 'unknown')
}

function codeCheckNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function codeCheckStatusRank(statusValue: unknown): number {
  const status = codeCheckText(statusValue).toLowerCase()
  if (status === 'fail' || status === 'failed') return 0
  if (status === 'warning' || status === 'warn') return 1
  if (status === 'not_applicable' || status === 'not-applicable' || status === 'n/a') return 2
  if (status === 'unknown') return 3
  return 4
}

function extractCodeCheckData(result: CodeCheckOverviewInput | null | undefined): Record<string, unknown> | null {
  const normalized = normalizeCodeCheckResultPayload(result)
  if (!normalized) {
    return null
  }

  const reportJson = asRecord(normalized.report?.json)
  const reportCodeCheck = asRecord(reportJson?.codeCheck)
  const topLevelCodeCheck = asRecord(normalized.codeCheck)
  const codeCheck = reportCodeCheck && Object.keys(reportCodeCheck).length > 0
    ? reportCodeCheck
    : topLevelCodeCheck
  if (!codeCheck || codeCheck.skipped === true) {
    return null
  }

  const data = asRecord(codeCheck.data)
  const payload = data && Object.keys(data).length > 0 ? data : codeCheck
  return payload.skipped === true ? null : payload
}

function flattenCodeCheckItems(data: Record<string, unknown>, locale: AppLocale): CodeCheckAttentionItem[] {
  const rows: CodeCheckAttentionItem[] = []
  const addItem = (
    item: Record<string, unknown>,
    detail: Record<string, unknown>,
    check: Record<string, unknown>
  ) => {
    const textItem = codeCheckText(item.item ?? item.name ?? check.item)
    const clause = codeCheckText(item.clause ?? check.clause)
    const message = codeCheckText(item.message ?? item.reason ?? check.message)
    const scope = codeCheckScopeValue(detail.elementId ?? detail.id, locale)
    rows.push({
      elementId: scope.label,
      scopeKind: scope.kind,
      check: codeCheckText(check.name ?? check.check ?? detail.check, 'unknown'),
      ...(textItem ? { item: textItem } : {}),
      ...(clause ? { clause } : {}),
      utilization: codeCheckUtilizationDisplayValue(item.utilization ?? check.utilization ?? detail.utilization, locale, {
        ...detail,
        ...check,
        ...item,
      }),
      rawStatus: codeCheckText(item.status ?? check.status ?? detail.status, 'unknown'),
      status: codeCheckStatusDisplayValue({
        ...detail,
        ...check,
        ...item,
        status: item.status ?? check.status ?? detail.status,
      }, locale),
      ...(message ? { message } : {}),
    })
  }

  for (const detail of codeCheckRecords(data.details)) {
    const checks = codeCheckRecords(detail.checks)
    for (const check of checks) {
      const items = codeCheckRecords(check.items)
      if (items.length === 0 && (check.status || check.item)) {
        addItem(check, detail, check)
      }
      for (const item of items) {
        addItem(item, detail, check)
      }
    }
    if (checks.length === 0 && (detail.status || detail.item)) {
      addItem(detail, detail, {})
    }
  }

  for (const check of codeCheckRecords(data.checks)) {
    const items = codeCheckRecords(check.items)
    if (items.length === 0 && (check.status || check.item)) {
      addItem(check, {}, check)
    }
    for (const item of items) {
      addItem(item, {}, check)
    }
  }

  return rows
}

export function extractCodeCheckOverview(
  result: CodeCheckOverviewInput | null | undefined,
  locale: AppLocale
): CodeCheckOverview | null {
  const data = extractCodeCheckData(result)
  if (!data) {
    return null
  }

  const summary = asRecord(data.summary)
  const hasSummary = Boolean(summary && Object.keys(summary).length > 0)
  const rows = flattenCodeCheckItems(data, locale)
  if (!hasSummary && rows.length === 0) {
    return null
  }

  const attentionItems = rows
    .filter((item) => codeCheckStatusRank(item.rawStatus) < 4)
    .sort((left, right) => codeCheckStatusRank(left.rawStatus) - codeCheckStatusRank(right.rawStatus))
    .slice(0, 8)

  const failedCount = codeCheckNumericValue(summary?.failed)
  const warningCount = codeCheckNumericValue(summary?.warnings)
  const derivedNotApplicableCount = rows.filter((item) => codeCheckStatusRank(item.rawStatus) === 2).length
  const explicitNotApplicableCount = codeCheckNumericValue(summary?.notApplicable ?? summary?.not_applicable)
  const notApplicableCount = explicitNotApplicableCount ?? (derivedNotApplicableCount > 0 ? derivedNotApplicableCount : null)
  const hasGoverning = Boolean(
    summary?.controllingElement
    || summary?.controllingCheck
    || (summary?.maxUtilization !== undefined && summary.maxUtilization !== null)
  )

  return {
    ...(hasSummary
      ? {
        summary: {
          total: codeCheckDisplayValue(summary?.total, locale),
          passed: codeCheckDisplayValue(summary?.passed, locale),
          failed: codeCheckDisplayValue(summary?.failed, locale),
          warnings: codeCheckDisplayValue(summary?.warnings, locale),
          ...(notApplicableCount !== null
            ? { notApplicable: codeCheckDisplayValue(notApplicableCount, locale) }
            : {}),
          status: failedCount !== null && failedCount > 0
            ? 'failed'
            : warningCount !== null && warningCount > 0
              ? 'warning'
              : notApplicableCount !== null && notApplicableCount > 0
                ? 'warning'
                : 'passed',
        } satisfies CodeCheckOverview['summary'],
      }
      : {}),
    ...(hasGoverning
      ? {
        governing: {
          element: codeCheckScopeValue(summary?.controllingElement, locale).label,
          check: codeCheckDisplayValue(summary?.controllingCheck, locale),
          utilization: codeCheckUtilizationDisplayValue(summary?.maxUtilization, locale),
        },
      }
      : {}),
    attentionItems,
  }
}
