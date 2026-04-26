'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Server, FileText, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { API_BASE } from '@/lib/api-base'
import { useI18n, type MessageKey } from '@/lib/i18n'

type ValueSource = 'runtime' | 'env' | 'default'
type Field<T> = { value: T; source: ValueSource }

type SettingsResponse = {
  server: { port: Field<number>; host: Field<string> }
  llm: {
    baseUrl: Field<string>; model: Field<string>
    hasApiKey: boolean; apiKeySource: ValueSource | 'unset'
    timeoutMs: Field<number>; maxRetries: Field<number>
  }
  database: { url: Field<string> }
  logging: { level: Field<string>; llmLogEnabled: Field<boolean> }
  analysis: { pythonBin: Field<string>; pythonTimeoutMs: Field<number> }
}

function inputClassName() {
  return 'mt-2 w-full rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 dark:border-white/10 dark:bg-white/5'
}

function sourceBadge(source: ValueSource, t: (key: MessageKey) => string) {
  const colors: Record<ValueSource, string> = {
    runtime: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
    env: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    default: 'bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400',
  }
  const labels: Record<ValueSource, string> = {
    runtime: t('generalSettingsSourceRuntime'),
    env: t('generalSettingsSourceEnv'),
    default: t('generalSettingsSourceDefault'),
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[source]}`}>
      {labels[source]}
    </span>
  )
}

export function GeneralSettingsPanel() {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  // Server
  const [port, setPort] = useState(8000)
  const [portSource, setPortSource] = useState<ValueSource>('default')
  const [host, setHost] = useState('0.0.0.0')
  const [hostSource, setHostSource] = useState<ValueSource>('default')

  // Logging
  const [logLevel, setLogLevel] = useState('info')
  const [logLevelSource, setLogLevelSource] = useState<ValueSource>('default')
  const [llmLogEnabled, setLlmLogEnabled] = useState(false)
  const [llmLogEnabledSource, setLlmLogEnabledSource] = useState<ValueSource>('default')

  // Analysis
  const [pythonBin, setPythonBin] = useState('')
  const [pythonBinSource, setPythonBinSource] = useState<ValueSource>('default')
  const [pythonTimeout, setPythonTimeout] = useState(600000)
  const [pythonTimeoutSource, setPythonTimeoutSource] = useState<ValueSource>('default')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [showRestartBanner, setShowRestartBanner] = useState(false)

  // Track original values for change detection
  const [originalPort, setOriginalPort] = useState(8000)
  const [originalHost, setOriginalHost] = useState('0.0.0.0')
  const [originalLogLevel, setOriginalLogLevel] = useState('info')
  const [originalPythonBin, setOriginalPythonBin] = useState('')
  const [originalPythonTimeout, setOriginalPythonTimeout] = useState(600000)

  function applyPayload(data: SettingsResponse) {
    setPort(data.server.port.value)
    setPortSource(data.server.port.source)
    setHost(data.server.host.value)
    setHostSource(data.server.host.source)
    setLogLevel(data.logging.level.value)
    setLogLevelSource(data.logging.level.source)
    setLlmLogEnabled(data.logging.llmLogEnabled.value)
    setLlmLogEnabledSource(data.logging.llmLogEnabled.source)
    setPythonBin(data.analysis.pythonBin.value)
    setPythonBinSource(data.analysis.pythonBin.source)
    setPythonTimeout(data.analysis.pythonTimeoutMs.value)
    setPythonTimeoutSource(data.analysis.pythonTimeoutMs.source)

    setOriginalPort(data.server.port.value)
    setOriginalHost(data.server.host.value)
    setOriginalLogLevel(data.logging.level.value)
    setOriginalPythonBin(data.analysis.pythonBin.value)
    setOriginalPythonTimeout(data.analysis.pythonTimeoutMs.value)
    setShowRestartBanner(false)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/admin/settings`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`${tRef.current('requestFailedHttp')} ${res.status}`)
        const data = await res.json() as SettingsResponse
        if (!cancelled) { applyPayload(data); setError('') }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings')
      }
    }
    void load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError('')
    setStatus('')

    const body: Record<string, unknown> = {}

    if (port !== originalPort || host !== originalHost) {
      body.server = { port, host }
    }
    if (logLevel !== originalLogLevel || llmLogEnabled !== false) {
      body.logging = { level: logLevel, llmLogEnabled }
    }
    if (pythonBin !== originalPythonBin || pythonTimeout !== originalPythonTimeout) {
      body.analysis = { pythonBin, pythonTimeoutMs: pythonTimeout }
    }

    if (Object.keys(body).length === 0) {
      setIsSaving(false)
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`${t('requestFailedHttp')} ${res.status}`)
      const data = await res.json() as SettingsResponse
      applyPayload(data)
      setStatus(t('generalSettingsSavedToast'))
      // Check if restart is needed (server or analysis changed)
      const needsRestart = body.server !== undefined || body.analysis !== undefined || (body.logging && logLevel !== originalLogLevel)
      if (needsRestart) setShowRestartBanner(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_320px]">
      <Card className="border-border/70 bg-card/85 shadow-[0_30px_90px_-45px_rgba(34,211,238,0.25)] dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">
              {t('generalSettingsNav')}
            </div>
            <CardTitle className="mt-1 flex items-center gap-2 text-2xl">
              <Server className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
              {t('generalSettingsNav')}
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Server, logging, and analysis configuration. Some changes require a restart.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {showRestartBanner && (
            <div className="mb-4 rounded-2xl border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
              {t('generalSettingsRestartBanner')}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* Server Section */}
            <div className="rounded-[24px] border border-border/70 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="mb-3 flex items-center gap-2">
                <Server className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <span className="text-sm font-semibold text-foreground">{t('generalSettingsServerSection')}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground" htmlFor="general-port">
                      {t('generalSettingsPortLabel')}
                    </label>
                    {sourceBadge(portSource, t)}
                  </div>
                  <input
                    id="general-port"
                    type="number"
                    min={1}
                    max={65535}
                    className={inputClassName()}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground" htmlFor="general-host">
                      {t('generalSettingsHostLabel')}
                    </label>
                    {sourceBadge(hostSource, t)}
                  </div>
                  <input
                    id="general-host"
                    className={inputClassName()}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Logging Section */}
            <div className="rounded-[24px] border border-border/70 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <span className="text-sm font-semibold text-foreground">{t('generalSettingsLoggingSection')}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground" htmlFor="general-log-level">
                      {t('generalSettingsLogLevelLabel')}
                    </label>
                    {sourceBadge(logLevelSource, t)}
                  </div>
                  <select
                    id="general-log-level"
                    className={inputClassName()}
                    value={logLevel}
                    onChange={(e) => setLogLevel(e.target.value)}
                  >
                    {['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <input
                    id="general-llm-log"
                    type="checkbox"
                    checked={llmLogEnabled}
                    onChange={(e) => setLlmLogEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-cyan-500"
                  />
                  <label htmlFor="general-llm-log" className="text-sm text-foreground">
                    {t('generalSettingsLlmLogLabel')}
                  </label>
                  {sourceBadge(llmLogEnabledSource, t)}
                </div>
              </div>
            </div>

            {/* Analysis Section */}
            <div className="rounded-[24px] border border-border/70 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="mb-3 flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <span className="text-sm font-semibold text-foreground">{t('generalSettingsAnalysisSection')}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground" htmlFor="general-python-bin">
                      {t('generalSettingsPythonBinLabel')}
                    </label>
                    {sourceBadge(pythonBinSource, t)}
                  </div>
                  <input
                    id="general-python-bin"
                    className={inputClassName()}
                    value={pythonBin}
                    onChange={(e) => setPythonBin(e.target.value)}
                    placeholder="Auto-detect"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground" htmlFor="general-python-timeout">
                      {t('generalSettingsPythonTimeoutLabel')}
                    </label>
                    {sourceBadge(pythonTimeoutSource, t)}
                  </div>
                  <input
                    id="general-python-timeout"
                    type="number"
                    min={1000}
                    className={inputClassName()}
                    value={pythonTimeout}
                    onChange={(e) => setPythonTimeout(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            {error && <p className="text-sm leading-6 text-amber-700 dark:text-amber-200">{error}</p>}
            {status && <p className="text-sm leading-6 text-emerald-700 dark:text-emerald-200">{status}</p>}

            <Button className="rounded-full px-6" type="submit" disabled={isSaving}>
              {isSaving ? '...' : t('generalSettingsSaveButton')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/85 dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <CardTitle className="text-lg">Configuration Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">settings.json</span> — Runtime overrides saved via this panel or the API. Takes highest priority.
          </p>
          <p>
            <span className="font-medium text-foreground">.env</span> — Environment file for advanced users. Falls through when no runtime override exists.
          </p>
          <p>
            <span className="font-medium text-foreground">Defaults</span> — Built-in defaults used when neither settings.json nor .env provides a value.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
