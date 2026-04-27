'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, KeyRound, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { API_BASE } from '@/lib/api-base'
import { useI18n } from '@/lib/i18n'

type LlmValueSource = 'runtime' | 'default'
type ApiKeySource = 'runtime' | 'unset'
type TokenMode = 'keep' | 'replace' | 'inherit'

type LlmSettingsResponse = {
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyMasked: string
  hasOverrides: boolean
  baseUrlSource: LlmValueSource
  modelSource: LlmValueSource
  apiKeySource: ApiKeySource
}

const MASKED_TOKEN = '********'

function inputClassName() {
  return 'mt-2 w-full rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 dark:border-white/10 dark:bg-white/5'
}

export function LlmSettingsPanel() {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [token, setToken] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [hasOverrides, setHasOverrides] = useState(false)
  const [baseUrlSource, setBaseUrlSource] = useState<LlmValueSource>('default')
  const [modelSource, setModelSource] = useState<LlmValueSource>('default')
  const [apiKeySource, setApiKeySource] = useState<ApiKeySource>('unset')
  const [tokenMode, setTokenMode] = useState<TokenMode>('replace')
  const [isSaving, setIsSaving] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  function applyPayload(payload: LlmSettingsResponse) {
    setBaseUrl(payload.baseUrl)
    setModel(payload.model)
    setHasApiKey(payload.hasApiKey)
    setHasOverrides(payload.hasOverrides)
    setBaseUrlSource(payload.baseUrlSource)
    setModelSource(payload.modelSource)
    setApiKeySource(payload.apiKeySource)
    setToken(payload.hasApiKey ? payload.apiKeyMasked : '')
    setTokenMode(payload.hasApiKey ? 'keep' : 'replace')
  }

  useEffect(() => {
    let cancelled = false

    async function loadSettings() {
      try {
        const response = await fetch(`${API_BASE}/api/v1/admin/llm`, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`${tRef.current('requestFailedHttp')} ${response.status}`)
        }

        const payload = await response.json() as LlmSettingsResponse
        if (cancelled) {
          return
        }

        applyPayload(payload)
        setError('')
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : tRef.current('llmSettingsLoadFailed'))
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function sourceLabel(source: LlmValueSource | ApiKeySource) {
    if (source === 'runtime') {
      return t('llmSettingsSourceRuntime')
    }
    if (source === 'default') {
      return t('llmSettingsSourceDefault')
    }
    return t('llmSettingsSourceUnset')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError('')
    setStatus('')

    const trimmedBaseUrl = baseUrl.trim()
    const trimmedModel = model.trim()
    const trimmedToken = token.trim()

    if (!trimmedBaseUrl || !trimmedModel) {
      setError(t('llmSettingsBaseUrlModelRequired'))
      setIsSaving(false)
      return
    }

    if (tokenMode === 'replace' && hasApiKey && trimmedToken.length === 0) {
      setError(t('llmSettingsTokenRequired'))
      setIsSaving(false)
      return
    }

    const body: {
      baseUrl: string
      model: string
      apiKeyMode: TokenMode
      apiKey?: string
    } = {
      baseUrl: trimmedBaseUrl,
      model: trimmedModel,
      apiKeyMode: tokenMode,
    }

    if (tokenMode === 'replace' && trimmedToken.length > 0) {
      body.apiKey = trimmedToken
    }

    try {
      const response = await fetch(`${API_BASE}/api/v1/admin/llm`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error(`${t('requestFailedHttp')} ${response.status}`)
      }

      const payload = await response.json() as LlmSettingsResponse
      applyPayload(payload)
      setStatus(t('llmSettingsSaved'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('llmSettingsSaveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleResetToEnvDefaults() {
    setIsResetting(true)
    setError('')
    setStatus('')

    try {
      const response = await fetch(`${API_BASE}/api/v1/admin/llm`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`${t('requestFailedHttp')} ${response.status}`)
      }

      const payload = await response.json() as LlmSettingsResponse
      applyPayload(payload)
      setStatus(t('llmSettingsSaved'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('llmSettingsSaveFailed'))
    } finally {
      setIsResetting(false)
    }
  }

  const tokenHelp = tokenMode === 'keep'
    ? t('llmSettingsTokenHelpKeep')
    : tokenMode === 'inherit'
      ? t('llmSettingsTokenHelpInherit')
      : hasApiKey
        ? t('llmSettingsTokenHelpReplace')
        : t('llmSettingsTokenHelpEmpty')

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_320px]">
      <Card className="border-border/70 bg-card/85 shadow-[0_30px_90px_-45px_rgba(34,211,238,0.25)] dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">{t('llmSettingsNav')}</div>
              <CardTitle className="mt-1 flex items-center gap-2 text-2xl">
                <Bot className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
                {t('llmSettingsTitle')}
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {t('llmSettingsIntro')}
              </CardDescription>
            </div>
            {hasOverrides && (
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => void handleResetToEnvDefaults()}
                disabled={isResetting || isSaving}
              >
                {t('llmSettingsResetDefaults')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="rounded-[24px] border border-border/70 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-foreground" htmlFor="llm-base-url">
                  {t('llmSettingsBaseUrl')}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t('llmSettingsCurrentSource')}: {sourceLabel(baseUrlSource)}
                </span>
              </div>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="llm-base-url"
                  className={`${inputClassName()} pl-11`}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={t('llmSettingsBaseUrlPlaceholder')}
                  required
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-foreground" htmlFor="llm-model">
                  {t('llmSettingsModel')}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t('llmSettingsCurrentSource')}: {sourceLabel(modelSource)}
                </span>
              </div>
              <div className="relative">
                <Bot className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="llm-model"
                  className={`${inputClassName()} pl-11`}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={t('llmSettingsModelPlaceholder')}
                  required
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-foreground" htmlFor="llm-token">
                  {t('llmSettingsToken')}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t('llmSettingsCurrentSource')}: {sourceLabel(apiKeySource)}
                </span>
              </div>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="llm-token"
                  type={tokenMode === 'replace' ? 'password' : 'text'}
                  className={`${inputClassName()} pl-11`}
                  value={token}
                  onChange={(event) => {
                    setTokenMode('replace')
                    setToken(event.target.value)
                  }}
                  placeholder={t('llmSettingsTokenPlaceholder')}
                  autoComplete="new-password"
                  readOnly={tokenMode !== 'replace'}
                />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {tokenHelp}
              </p>
              {(hasApiKey || apiKeySource === 'runtime') && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {hasApiKey && tokenMode !== 'keep' && (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        setTokenMode('keep')
                        setToken(MASKED_TOKEN)
                      }}
                    >
                      {t('llmSettingsKeepCurrentToken')}
                    </Button>
                  )}
                  {tokenMode !== 'replace' && (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        setTokenMode('replace')
                        setToken('')
                      }}
                    >
                      {t('llmSettingsReplaceToken')}
                    </Button>
                  )}
                  {apiKeySource === 'runtime' && tokenMode !== 'inherit' && (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        setTokenMode('inherit')
                        setToken(MASKED_TOKEN)
                      }}
                    >
                      {t('llmSettingsClearToken')}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p className="text-sm leading-6 text-amber-700 dark:text-amber-200">
                {error}
              </p>
            )}

            {status && (
              <p className="text-sm leading-6 text-emerald-700 dark:text-emerald-200">
                {status}
              </p>
            )}

            <Button className="rounded-full px-6" type="submit" disabled={isSaving || isResetting}>
              {isSaving ? t('llmSettingsSaving') : t('llmSettingsSave')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/85 dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <CardTitle className="text-lg">{t('llmSettingsRuntimeTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>{t('llmSettingsRuntimeBody1')}</p>
          <p>{t('llmSettingsRuntimeBody2')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
