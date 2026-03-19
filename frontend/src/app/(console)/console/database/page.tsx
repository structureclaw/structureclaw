'use client'

import { useEffect, useState } from 'react'
import { Database, ExternalLink, Server, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { API_BASE } from '@/lib/api-base'
import { useI18n } from '@/lib/i18n'

const FALLBACK_PGADMIN_URL = 'http://localhost:5050'

type DatabaseAdminStatus = {
  enabled: boolean
  provider: string
  url: string
  defaultEmail?: string
  database?: {
    host?: string
    port?: string
    database?: string
  }
}

export default function DatabaseAdminPage() {
  const { t } = useI18n()
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
          setStatus({
            enabled: true,
            provider: 'pgadmin',
            url: FALLBACK_PGADMIN_URL,
            database: {
              host: 'localhost',
              port: '5432',
              database: 'structureclaw',
            },
          })
        }
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [t])

  const effectiveStatus = status ?? {
    enabled: true,
    provider: 'pgadmin',
    url: FALLBACK_PGADMIN_URL,
  }

  const statusLabel = effectiveStatus.enabled
    ? t('databaseAdminStatusEnabled')
    : t('databaseAdminStatusDisabled')

  const databaseTarget = effectiveStatus.database
    ? `${effectiveStatus.database.host || 'localhost'}:${effectiveStatus.database.port || '5432'} / ${effectiveStatus.database.database || 'structureclaw'}`
    : 'localhost:5432 / structureclaw'

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
            <Button
              asChild
              className="rounded-full bg-cyan-300 px-5 text-slate-950 hover:bg-cyan-200"
            >
              <a href={effectiveStatus.url || FALLBACK_PGADMIN_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t('databaseAdminOpen')}
              </a>
            </Button>
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
            <div className="mt-3 break-all text-sm font-medium text-foreground">{effectiveStatus.url || FALLBACK_PGADMIN_URL}</div>
            <div className="mt-4 text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminDefaultLogin')}</div>
            <div className="mt-2 text-sm text-foreground">{effectiveStatus.defaultEmail || 'admin@structureclaw.local'}</div>
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
              <Server className="h-4 w-4" />
              {t('databaseAdminTarget')}
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">{databaseTarget}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('databaseAdminTargetHelp')}</p>
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('databaseAdminProvider')}</div>
            <div className="mt-3 text-sm font-medium uppercase text-foreground">{effectiveStatus.provider || 'pgadmin'}</div>
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
