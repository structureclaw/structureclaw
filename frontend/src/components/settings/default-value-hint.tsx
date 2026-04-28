'use client'

import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type DefaultValue = string | number | boolean

function formatDefaultValue(value: DefaultValue, t: (key: 'generalSettingsBooleanTrue' | 'generalSettingsBooleanFalse' | 'generalSettingsEmptyValue') => string): string {
  if (typeof value === 'boolean') return t(value ? 'generalSettingsBooleanTrue' : 'generalSettingsBooleanFalse')
  if (typeof value === 'string' && value.length === 0) return t('generalSettingsEmptyValue')
  return String(value)
}

export function DefaultValueHint({ value, className }: { value: DefaultValue; className?: string }) {
  const { t } = useI18n()

  return (
    <p className={cn('mt-1 min-w-0 break-words text-xs leading-5 text-muted-foreground', className)}>
      {t('generalSettingsDefaultValuePrefix')}: <span className="font-mono">{formatDefaultValue(value, t)}</span>
    </p>
  )
}
