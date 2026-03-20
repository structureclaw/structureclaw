'use client'

import { useEffect, useState } from 'react'
import { Database, HardDrive, Server, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { API_BASE } from '@/lib/api-base'
import { useI18n } from '@/lib/i18n'

type DatabaseAdminStatus = {
  enabled: boolean
  provider: string
  mode?: string
  database?: {
    provider?: string
    databaseUrl?: string
    databasePath?: string
    directoryPath?: string
    exists?: boolean
    writable?: boolean
    sizeBytes?: number
  }
}

const FALLBACK_STATUS: DatabaseAdminStatus = {
  enabled: false,
  provider: 'sqlite',
  mode: 'local-file',
  database: {
    provider: 'sqlite',
    databaseUrl: 'file:.runtime/data/structureclaw.db',
    databasePath: '.runtime/data/structureclaw.db',
    directoryPath: '.runtime/data',
    exists: false,
    writable: false,
    sizeBytes: 0,
  },
}

function formatBytes(sizeBytes: number | undefined, locale: string) {
  const size = sizeBytes ?? 0
  if (size <= 0) {
    return '0 B'
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(size / (1024 * 1024)) + ' MB'
}

export default function DatabaseAdminPage() {
  const { t, locale } = useI18n()
  const [status, setStatus] = useState<DatabaseAdminStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      try {
        const response = await fetch(`${API_BASE}/api/v1/admin/database/status`, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`${t('requestFailedHttp')} ${response.status}`)
        }

        const payload = await response.json() as DatabaseAdminStatus
        if (!cancelled) {
          setStatus(payload)
          setError('')
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : t('databaseAdminFetchFailed'))
          setStatus(FALLBACK_STATUS)
        }
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [t])

  const effectiveStatus = status ?? FALLBACK_STATUS
  const database = effectiveStatus.database ?? FALLBACK_STATUS.database!
  const statusLabel = effectiveStatus.enabled
    ? t('databaseAdminStatusEnabled')
    : t('databaseAdminStatusDisabled')
  const fileExistsLabel = database.exists
    ? t('databaseAdminFileExistsYes')
    : t('databaseAdminFileExistsNo')
  const writableLabel = database.writable
    ? t('databaseAdminWritableYes')
    : t('databaseAdminWritableNo')
  const sizeLabel = formatBytes(database.sizeBytes, locale)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_360px]">
      <Card className="border-border/70 bg-card/85 shadow-[0_30px_90px_-45px_rgba(34,211,238,0.25)] dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">{t('databaseAdminNav')}</div>
              <CardTitle className="mt-1 flex items-center gap-2 text-2xl">
                <Database className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
                {t('databaseAdminTitle')}
              </CardTitle>
              <CardDescription className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t('databaseAdminIntro')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminStatusLabel')}</div>
            <div className="mt-3 text-lg font-semibold text-foreground">{statusLabel}</div>
            {!effectiveStatus.enabled && (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('databaseAdminUnavailableBody')}
              </p>
            )}
            {error && (
              <p className="mt-2 text-sm leading-6 text-amber-700 dark:text-amber-200">
                {t('databaseAdminFetchFailed')}
              </p>
            )}
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminAccessUrl')}</div>
            <div className="mt-3 break-all text-sm font-medium text-foreground">{database.databaseUrl}</div>
            <div className="mt-4 text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminDirectory')}</div>
            <div className="mt-2 break-all text-sm text-foreground">{database.directoryPath}</div>
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              {t('databaseAdminTarget')}
            </div>
            <div className="mt-3 break-all text-sm font-medium text-foreground">{database.databasePath}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('databaseAdminTargetHelp')}</p>
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminProvider')}</div>
            <div className="mt-3 text-sm font-medium uppercase text-foreground">{effectiveStatus.provider || 'sqlite'}</div>
            <div className="mt-4 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
              <Server className="h-4 w-4" />
              {t('databaseAdminMode')}
            </div>
            <div className="mt-2 text-sm text-foreground">{effectiveStatus.mode || 'local-file'}</div>
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminFileExists')}</div>
            <div className="mt-3 text-sm font-medium text-foreground">{fileExistsLabel}</div>
            <div className="mt-4 text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminWritable')}</div>
            <div className="mt-2 text-sm text-foreground">{writableLabel}</div>
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminFileSize')}</div>
            <div className="mt-3 text-sm font-medium text-foreground">{sizeLabel}</div>
            <div className="mt-4 text-xs text-muted-foreground">{t('databaseAdminOpenHint')}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/85 dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            {t('databaseAdminTroubleshootingTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>{t('databaseAdminTroubleshootingStep1')}</p>
          <p>{t('databaseAdminTroubleshootingStep2')}</p>
          <p>{t('databaseAdminTroubleshootingStep3')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
