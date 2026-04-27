'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Server, FileText, FlaskConical, Folder, Globe, Bot, Cpu, Cog,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { API_BASE } from '@/lib/api-base'
import { useI18n, type MessageKey } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ValueSource = 'runtime' | 'default'
type Field<T> = { value: T; source: ValueSource }

type SettingsResponse = {
  server: { port: Field<number>; host: Field<string>; bodyLimitMb: Field<number>; frontendPort: Field<number> }
  llm: { baseUrl: Field<string>; model: Field<string>; hasApiKey: boolean; apiKeySource: ValueSource | 'unset'; timeoutMs: Field<number>; maxRetries: Field<number> }
  database: { url: Field<string> }
  logging: { level: Field<string>; llmLogEnabled: Field<boolean>; logMaxAgeDays: Field<number>; logMaxSize: Field<number>; llmLogDir: Field<string> }
  analysis: { pythonBin: Field<string>; pythonTimeoutMs: Field<number>; engineManifestPath: Field<string> }
  storage: { reportsDir: Field<string>; maxFileSize: Field<number> }
  cors: { origins: Field<string> }
  agent: { workspaceRoot: Field<string>; checkpointDir: Field<string>; allowShell: Field<boolean>; allowedShellCommands: Field<string>; shellTimeoutMs: Field<number> }
  pkpm: { cyclePath: Field<string>; workDir: Field<string> }
  yjk: { installRoot: Field<string>; exePath: Field<string>; pythonBin: Field<string>; workDir: Field<string>; version: Field<string>; timeoutS: Field<number>; invisible: Field<boolean> }
}

type FieldKind = 'text' | 'number' | 'select' | 'checkbox'

interface FieldDef {
  key: string
  labelKey: MessageKey
  kind: FieldKind
  sectionKey: string
  stateKey: string
  props?: Record<string, unknown>
  options?: string[]
}

// ---------------------------------------------------------------------------
// Field registry — declarative form definition
// ---------------------------------------------------------------------------

const SECTIONS: { key: string; labelKey: MessageKey; icon: typeof Server }[] = [
  { key: 'server', labelKey: 'generalSettingsServerSection', icon: Server },
  { key: 'logging', labelKey: 'generalSettingsLoggingSection', icon: FileText },
  { key: 'analysis', labelKey: 'generalSettingsAnalysisSection', icon: FlaskConical },
  { key: 'storage', labelKey: 'generalSettingsStorageSection', icon: Folder },
  { key: 'cors', labelKey: 'generalSettingsCorsSection', icon: Globe },
  { key: 'agent', labelKey: 'generalSettingsAgentSection', icon: Bot },
  { key: 'pkpm', labelKey: 'generalSettingsPkpmSection', icon: Cpu },
  { key: 'yjk', labelKey: 'generalSettingsYjkSection', icon: Cog },
]

const FIELDS: FieldDef[] = [
  // Server
  { key: 'server.port', labelKey: 'generalSettingsPortLabel', kind: 'number', sectionKey: 'server', stateKey: 'port', props: { min: 1, max: 65535 } },
  { key: 'server.host', labelKey: 'generalSettingsHostLabel', kind: 'text', sectionKey: 'server', stateKey: 'host' },
  { key: 'server.bodyLimitMb', labelKey: 'generalSettingsBodyLimitLabel', kind: 'number', sectionKey: 'server', stateKey: 'bodyLimitMb', props: { min: 1 } },
  { key: 'server.frontendPort', labelKey: 'generalSettingsFrontendPortLabel', kind: 'number', sectionKey: 'server', stateKey: 'frontendPort', props: { min: 1, max: 65535 } },
  // Logging
  { key: 'logging.level', labelKey: 'generalSettingsLogLevelLabel', kind: 'select', sectionKey: 'logging', stateKey: 'level', options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
  { key: 'logging.llmLogEnabled', labelKey: 'generalSettingsLlmLogLabel', kind: 'checkbox', sectionKey: 'logging', stateKey: 'llmLogEnabled' },
  { key: 'logging.logMaxAgeDays', labelKey: 'generalSettingsLogMaxAgeLabel', kind: 'number', sectionKey: 'logging', stateKey: 'logMaxAgeDays', props: { min: 1 } },
  { key: 'logging.logMaxSize', labelKey: 'generalSettingsLogMaxSizeLabel', kind: 'number', sectionKey: 'logging', stateKey: 'logMaxSize', props: { min: 1 } },
  { key: 'logging.llmLogDir', labelKey: 'generalSettingsLlmLogDirLabel', kind: 'text', sectionKey: 'logging', stateKey: 'llmLogDir' },
  // Analysis
  { key: 'analysis.pythonBin', labelKey: 'generalSettingsPythonBinLabel', kind: 'text', sectionKey: 'analysis', stateKey: 'pythonBin' },
  { key: 'analysis.pythonTimeoutMs', labelKey: 'generalSettingsPythonTimeoutLabel', kind: 'number', sectionKey: 'analysis', stateKey: 'pythonTimeoutMs', props: { min: 1000 } },
  { key: 'analysis.engineManifestPath', labelKey: 'generalSettingsEngineManifestLabel', kind: 'text', sectionKey: 'analysis', stateKey: 'engineManifestPath' },
  // Storage
  { key: 'storage.reportsDir', labelKey: 'generalSettingsReportsDirLabel', kind: 'text', sectionKey: 'storage', stateKey: 'reportsDir' },
  { key: 'storage.maxFileSize', labelKey: 'generalSettingsMaxFileSizeLabel', kind: 'number', sectionKey: 'storage', stateKey: 'maxFileSize', props: { min: 1 } },
  // CORS
  { key: 'cors.origins', labelKey: 'generalSettingsCorsOriginsLabel', kind: 'text', sectionKey: 'cors', stateKey: 'origins' },
  // Agent
  { key: 'agent.workspaceRoot', labelKey: 'generalSettingsWorkspaceRootLabel', kind: 'text', sectionKey: 'agent', stateKey: 'workspaceRoot' },
  { key: 'agent.checkpointDir', labelKey: 'generalSettingsCheckpointDirLabel', kind: 'text', sectionKey: 'agent', stateKey: 'checkpointDir' },
  { key: 'agent.allowShell', labelKey: 'generalSettingsAllowShellLabel', kind: 'checkbox', sectionKey: 'agent', stateKey: 'allowShell' },
  { key: 'agent.allowedShellCommands', labelKey: 'generalSettingsAllowedShellLabel', kind: 'text', sectionKey: 'agent', stateKey: 'allowedShellCommands' },
  { key: 'agent.shellTimeoutMs', labelKey: 'generalSettingsShellTimeoutLabel', kind: 'number', sectionKey: 'agent', stateKey: 'shellTimeoutMs', props: { min: 1000 } },
  // PKPM
  { key: 'pkpm.cyclePath', labelKey: 'generalSettingsPkpmCyclePathLabel', kind: 'text', sectionKey: 'pkpm', stateKey: 'pkpmCyclePath' },
  { key: 'pkpm.workDir', labelKey: 'generalSettingsPkpmWorkDirLabel', kind: 'text', sectionKey: 'pkpm', stateKey: 'pkpmWorkDir' },
  // YJK
  { key: 'yjk.installRoot', labelKey: 'generalSettingsYjkInstallRootLabel', kind: 'text', sectionKey: 'yjk', stateKey: 'yjkInstallRoot' },
  { key: 'yjk.exePath', labelKey: 'generalSettingsYjkExePathLabel', kind: 'text', sectionKey: 'yjk', stateKey: 'yjkExePath' },
  { key: 'yjk.pythonBin', labelKey: 'generalSettingsYjkPythonBinLabel', kind: 'text', sectionKey: 'yjk', stateKey: 'yjkPythonBin' },
  { key: 'yjk.workDir', labelKey: 'generalSettingsYjkWorkDirLabel', kind: 'text', sectionKey: 'yjk', stateKey: 'yjkWorkDir' },
  { key: 'yjk.version', labelKey: 'generalSettingsYjkVersionLabel', kind: 'text', sectionKey: 'yjk', stateKey: 'yjkVersion' },
  { key: 'yjk.timeoutS', labelKey: 'generalSettingsYjkTimeoutLabel', kind: 'number', sectionKey: 'yjk', stateKey: 'yjkTimeoutS', props: { min: 1 } },
  { key: 'yjk.invisible', labelKey: 'generalSettingsYjkInvisibleLabel', kind: 'checkbox', sectionKey: 'yjk', stateKey: 'yjkInvisible' },
]

// Default values for each field (used before API responds)
const DEFAULTS: Record<string, string | number | boolean> = {
  port: 8000, host: '0.0.0.0', bodyLimitMb: 20, frontendPort: 30000,
  level: 'info', llmLogEnabled: false, logMaxAgeDays: 7, logMaxSize: 104857600, llmLogDir: '',
  pythonBin: '', pythonTimeoutMs: 600000, engineManifestPath: '',
  reportsDir: '', maxFileSize: 104857600,
  origins: '',
  workspaceRoot: '', checkpointDir: '', allowShell: false, allowedShellCommands: 'node,npm,python,python3,./sclaw,./sclaw_cn', shellTimeoutMs: 300000,
  pkpmCyclePath: '', pkpmWorkDir: '',
  yjkInstallRoot: '', yjkExePath: '', yjkPythonBin: '', yjkWorkDir: '', yjkVersion: '8.0.0', yjkTimeoutS: 600, yjkInvisible: false,
}

// Map stateKey → API field name for sections that use different naming
const STATE_TO_API_KEY: Record<string, string> = {
  pkpmCyclePath: 'cyclePath', pkpmWorkDir: 'workDir',
  yjkInstallRoot: 'installRoot', yjkExePath: 'exePath', yjkPythonBin: 'pythonBin', yjkWorkDir: 'workDir',
  yjkVersion: 'version', yjkTimeoutS: 'timeoutS', yjkInvisible: 'invisible',
}

// Map stateKey → response path for extraction
function extractFieldValue(data: SettingsResponse, sectionKey: string, stateKey: string): { value: string | number | boolean; source: ValueSource } {
  const apiKey = STATE_TO_API_KEY[stateKey] ?? stateKey
  const section = (data as unknown as Record<string, Record<string, { value: unknown; source: ValueSource }>>)[sectionKey]
  const field = section?.[apiKey]
  if (!field) return { value: DEFAULTS[stateKey] ?? '', source: 'default' }
  return { value: field.value as string | number | boolean, source: field.source }
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

const INPUT_CLS = 'mt-2 w-full rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 dark:border-white/10 dark:bg-white/5'

function SourceBadge({ source, t }: { source: ValueSource; t: (key: MessageKey) => string }) {
  const colors: Record<ValueSource, string> = {
    runtime: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
    default: 'bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400',
  }
  const labels: Record<ValueSource, MessageKey> = {
    runtime: 'generalSettingsSourceRuntime',
    default: 'generalSettingsSourceDefault',
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[source]}`}>
      {t(labels[source])}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GeneralSettingsPanel() {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t

  // Flat state: values + sources + originals
  const [values, setValues] = useState<Record<string, string | number | boolean>>({ ...DEFAULTS })
  const [sources, setSources] = useState<Record<string, ValueSource>>({})
  const [originals, setOriginals] = useState<Record<string, string | number | boolean>>({ ...DEFAULTS })

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [showRestartBanner, setShowRestartBanner] = useState(false)

  function applyPayload(data: SettingsResponse) {
    const newValues: Record<string, string | number | boolean> = {}
    const newSources: Record<string, ValueSource> = {}
    for (const field of FIELDS) {
      const { value, source } = extractFieldValue(data, field.sectionKey, field.stateKey)
      newValues[field.stateKey] = value
      newSources[field.stateKey] = source
    }
    setValues(newValues)
    setSources(newSources)
    setOriginals({ ...newValues })
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

  function setValue(key: string, val: string | number | boolean) {
    setValues((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError('')
    setStatus('')

    // Build PUT body — only changed fields grouped by section
    const body: Record<string, Record<string, unknown>> = {}
    for (const field of FIELDS) {
      if (values[field.stateKey] !== originals[field.stateKey]) {
        if (!body[field.sectionKey]) body[field.sectionKey] = {}
        const apiKey = STATE_TO_API_KEY[field.stateKey] ?? field.stateKey
        body[field.sectionKey][apiKey] = values[field.stateKey]
      }
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
      setShowRestartBanner(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  // Render field by kind
  function renderField(field: FieldDef) {
    const val = values[field.stateKey]
    const src = sources[field.stateKey] ?? 'default'

    if (field.kind === 'checkbox') {
      return (
        <div key={field.key} className="flex items-center gap-3 pt-1">
          <input
            id={`general-${field.key}`}
            type="checkbox"
            checked={!!val}
            onChange={(e) => setValue(field.stateKey, e.target.checked)}
            className="h-4 w-4 rounded border-border accent-cyan-500"
          />
          <label htmlFor={`general-${field.key}`} className="text-sm text-foreground">
            {t(field.labelKey)}
          </label>
          <SourceBadge source={src} t={t} />
        </div>
      )
    }

    return (
      <div key={field.key}>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-foreground" htmlFor={`general-${field.key}`}>
            {t(field.labelKey)}
          </label>
          <SourceBadge source={src} t={t} />
        </div>
        {field.kind === 'select' ? (
          <select
            id={`general-${field.key}`}
            className={INPUT_CLS}
            value={String(val)}
            onChange={(e) => setValue(field.stateKey, e.target.value)}
          >
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : field.kind === 'number' ? (
          <input
            id={`general-${field.key}`}
            type="number"
            className={INPUT_CLS}
            value={Number(val) || 0}
            onChange={(e) => setValue(field.stateKey, Number(e.target.value))}
            {...(field.props as Record<string, number>)}
          />
        ) : (
          <input
            id={`general-${field.key}`}
            className={INPUT_CLS}
            value={String(val)}
            onChange={(e) => setValue(field.stateKey, e.target.value)}
          />
        )}
      </div>
    )
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
              Server, logging, analysis, and engine configuration. Some changes require a restart.
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
            {SECTIONS.map((section) => {
              const sectionFields = FIELDS.filter((f) => f.sectionKey === section.key)
              if (sectionFields.length === 0) return null
              const Icon = section.icon
              return (
                <div key={section.key} className="rounded-[24px] border border-border/70 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="mb-3 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    <span className="text-sm font-semibold text-foreground">{t(section.labelKey)}</span>
                  </div>
                  <div className={`grid gap-4 ${sectionFields.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                    {sectionFields.map(renderField)}
                  </div>
                </div>
              )
            })}

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
            <span className="font-medium text-foreground">settings.json</span> — Configuration saved via this panel or the API. All changes are stored here.
          </p>
          <p>
            <span className="font-medium text-foreground">Defaults</span> — Built-in defaults used when settings.json does not provide a value.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
