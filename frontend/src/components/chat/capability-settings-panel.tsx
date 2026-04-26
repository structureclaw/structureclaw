'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { API_BASE } from '@/lib/api-base'
import { ALL_SKILL_DOMAINS, buildSkillNormalizationContext, DEFAULT_CONSOLE_SKILL_IDS, normalizeSkillDomain, type SkillDomain, type SkillMetadataLike } from '@/lib/skill-normalization'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import { useStore } from '@/lib/stores/context'
import { cn } from '@/lib/utils'

type AgentSkillSummary = SkillMetadataLike & {
  name: { zh?: string; en?: string }
  description: { zh?: string; en?: string }
  domain?: string
  structureType?: string
  stages?: string[]
}

type ToolCategory = 'modeling' | 'analysis' | 'code-check' | 'report' | 'utility'

type CapabilitySkillSummary = {
  id: string
  domain?: SkillDomain
  runtimeStatus?: 'active' | 'partial' | 'discoverable' | 'reserved'
}

type CapabilityToolSummary = {
  id: string
  category?: ToolCategory
  source?: 'builtin' | 'skill'
  enabledByDefault?: boolean
  requiresTools?: string[]
  displayName?: { zh?: string; en?: string }
  description?: { zh?: string; en?: string }
}

type CapabilityDomainSummary = {
  domain: SkillDomain
  runtimeStatus?: 'active' | 'partial' | 'discoverable' | 'reserved'
  skillIds?: string[]
  autoLoadSkillIds?: string[]
}

type CapabilityMatrixPayload = {
  skills?: CapabilitySkillSummary[]
  tools?: CapabilityToolSummary[]
  domainSummaries?: CapabilityDomainSummary[]
  skillDomainById?: Record<string, SkillDomain>
  enabledToolIdsBySkill?: Record<string, string[]>
  canonicalSkillIdByAlias?: Record<string, string>
  skillAliasesByCanonicalId?: Record<string, string[]>
}

const ALL_TOOL_CATEGORIES: ToolCategory[] = ['modeling', 'analysis', 'code-check', 'report', 'utility']

/** Infer domain from skill id when capability-matrix is unavailable. */
function inferDomainFromSkillId(id: string): SkillDomain {
  if (id.startsWith('code-check-')) return 'code-check'
  if (id.startsWith('visualization-')) return 'visualization'
  if (id.startsWith('opensees-') || id.startsWith('simplified-')) return 'analysis'
  if (id === 'load-combination' || id === 'boundary-condition' || id.endsWith('-load')) return 'load-boundary'
  if (id === 'structure-json') return 'validation'
  if (id === 'png-export') return 'report-export'
  if (id === 'generic') return 'general'
  if (['beam', 'double-span-beam', 'frame', 'portal-frame', 'truss'].includes(id)) return 'structure-type'
  return 'general'
}


function normalizeToolCategory(value: unknown): ToolCategory {
  if (value === 'modeling' || value === 'analysis' || value === 'code-check' || value === 'report' || value === 'utility') {
    return value
  }
  return 'utility'
}

function resolveSkillDomainLabel(domain: SkillDomain, t: (key: MessageKey) => string) {
  if (domain === 'analysis') return t('skillDomainAnalysis')
  if (domain === 'data-input') return t('skillDomainDataInput')
  if (domain === 'design') return t('skillDomainDesign')
  if (domain === 'drawing') return t('skillDomainDrawing')
  if (domain === 'general') return t('skillDomainGeneral')
  if (domain === 'material') return t('skillDomainMaterial')
  if (domain === 'section') return t('skillDomainSection')
  if (domain === 'structure-type') return t('skillDomainStructureType')
  if (domain === 'load-boundary') return t('skillDomainLoadBoundary')
  if (domain === 'code-check') return t('skillDomainCodeCheck')
  if (domain === 'result-postprocess') return t('skillDomainResultPostprocess')
  if (domain === 'visualization') return t('skillDomainVisualization')
  if (domain === 'report-export') return t('skillDomainReportExport')
  if (domain === 'validation') return t('skillDomainValidation')
  return t('skillDomainUnknown')
}

function resolveToolCategoryLabel(category: ToolCategory, t: (key: MessageKey) => string) {
  if (category === 'modeling') return t('toolCategoryModeling')
  if (category === 'analysis') return t('toolCategoryAnalysis')
  if (category === 'code-check') return t('toolCategoryCodeCheck')
  if (category === 'report') return t('toolCategoryReport')
  return t('toolCategoryUtility')
}

function resolveToolLabel(tool: CapabilityToolSummary, locale: AppLocale) {
  const localized = locale === 'zh' ? (tool.displayName?.zh || tool.id) : (tool.displayName?.en || tool.id)
  if (localized && localized !== tool.id) {
    return localized
  }
  return tool.id
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function CapabilitySettingsPanel() {
  const { t, locale } = useI18n()
  const [availableSkills, setAvailableSkills] = useState<AgentSkillSummary[]>([])
  const [capabilityMatrix, setCapabilityMatrix] = useState<CapabilityMatrixPayload | null>(null)
  const initializedRef = useRef(false)
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  const [capabilityMatrixLoaded, setCapabilityMatrixLoaded] = useState(false)

  const storeSkillIds = useStore((s) => s.capabilitySkillIds)
  const storeToolIds = useStore((s) => s.capabilityToolIds)
  const storeExplicit = useStore((s) => s.capabilityExplicit)
  const setCapabilityPreferences = useStore((s) => s.setCapabilityPreferences)

  const skillNormalization = useMemo(
    () => buildSkillNormalizationContext(availableSkills, capabilityMatrix),
    [availableSkills, capabilityMatrix]
  )
  const skillDomainById = skillNormalization.skillDomainById

  const availableTools = useMemo(() => {
    const allTools = Array.isArray(capabilityMatrix?.tools) ? capabilityMatrix.tools : []
    return [...allTools].sort((a, b) => resolveToolLabel(a, locale).localeCompare(resolveToolLabel(b, locale)))
  }, [capabilityMatrix, locale])

  const defaultSelectedSkillIds = useMemo(() => {
    const available = new Set(availableSkills.map((skill) => skill.id))
    return [...DEFAULT_CONSOLE_SKILL_IDS].filter((skillId) => available.has(skillId))
  }, [availableSkills])

  const defaultSelectedToolIds = useMemo(
    () => availableTools.filter((tool) => tool.enabledByDefault).map((tool) => tool.id),
    [availableTools]
  )

  useEffect(() => {
    let active = true

    async function loadSkills() {
      const response = await fetch(`${API_BASE}/api/v1/agent/skills`)
      if (!response.ok) {
        if (active) setSkillsLoaded(true)
        return
      }
      const payload = await response.json()
      const skillsArray = Array.isArray(payload) ? payload : Array.isArray(payload?.skills) ? payload.skills : null
      if (active) {
        if (skillsArray) {
          setAvailableSkills(skillsArray as AgentSkillSummary[])
        }
        setSkillsLoaded(true)
      }
    }

    void loadSkills().catch(() => {
      if (active) {
        setAvailableSkills([])
        setSkillsLoaded(true)
      }
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadCapabilityMatrix() {
      const response = await fetch(`${API_BASE}/api/v1/agent/capability-matrix`)
      if (!response.ok) {
        if (active) setCapabilityMatrixLoaded(true)
        return
      }
      const payload = await response.json()
      if (active && payload && typeof payload === 'object') {
        setCapabilityMatrix(payload as CapabilityMatrixPayload)
        setCapabilityMatrixLoaded(true)
      }
    }

    void loadCapabilityMatrix().catch(() => {
      if (active) {
        setCapabilityMatrix(null)
        setCapabilityMatrixLoaded(true)
      }
    })

    return () => {
      active = false
    }
  }, [])

  // One-time initialization: normalize store IDs and apply defaults if needed
  useEffect(() => {
    if (initializedRef.current) return
    if (!skillsLoaded || !capabilityMatrixLoaded) return
    initializedRef.current = true

    if (storeSkillIds.length === 0 && storeToolIds.length === 0 && !storeExplicit) {
      setCapabilityPreferences(defaultSelectedSkillIds, defaultSelectedToolIds, false)
    } else {
      const validSkillIds = skillNormalization.normalizeSkillIds(storeSkillIds)
        .filter((skillId) => availableSkills.some((skill) => skill.id === skillId))
      const allToolIds = new Set(availableTools.map((tool) => tool.id))
      const validToolIds = storeToolIds.filter((toolId) => allToolIds.has(toolId))
      setCapabilityPreferences(validSkillIds, validToolIds, storeExplicit)
    }
  }, [availableSkills, availableTools, capabilityMatrixLoaded, defaultSelectedSkillIds, defaultSelectedToolIds, setCapabilityPreferences, skillNormalization, skillsLoaded, storeExplicit, storeSkillIds, storeToolIds])

  // Derive normalized selections from store
  const selectedSkillIds = useMemo(() => {
    return skillNormalization.normalizeSkillIds(storeSkillIds)
      .filter((skillId) => availableSkills.some((skill) => skill.id === skillId))
  }, [skillNormalization, storeSkillIds, availableSkills])

  const selectedToolIds = useMemo(() => {
    const allToolIds = new Set(availableTools.map((tool) => tool.id))
    return storeToolIds.filter((toolId) => allToolIds.has(toolId))
  }, [storeToolIds, availableTools])

  const groupedSkills = useMemo(() => {
    const bucket = new Map<SkillDomain, AgentSkillSummary[]>()
    availableSkills.forEach((skill) => {
      const domain = skillDomainById[skill.id]
        || normalizeSkillDomain(skill.domain)
        || inferDomainFromSkillId(skill.id)
      const list = bucket.get(domain) || []
      list.push(skill)
      bucket.set(domain, list)
    })

    return ALL_SKILL_DOMAINS.map((domain) => {
      const skills = [...(bucket.get(domain) || [])].sort((a, b) => {
        const left = locale === 'zh' ? (a.name.zh || a.id) : (a.name.en || a.id)
        const right = locale === 'zh' ? (b.name.zh || b.id) : (b.name.en || b.id)
        return left.localeCompare(right)
      })
      const skillIds = skills.map((skill) => skill.id)
      const selectedCount = skillIds.filter((skillId) => selectedSkillIds.includes(skillId)).length
      return {
        domain,
        label: resolveSkillDomainLabel(domain, t),
        skills,
        skillIds,
        selectedCount,
      }
    })
  }, [availableSkills, locale, selectedSkillIds, skillDomainById, t])

  const groupedTools = useMemo(() => {
    const bucket = new Map<ToolCategory, CapabilityToolSummary[]>()
    availableTools.forEach((tool) => {
      const category = normalizeToolCategory(tool.category)
      const list = bucket.get(category) || []
      list.push(tool)
      bucket.set(category, list)
    })

    return ALL_TOOL_CATEGORIES.map((category) => {
      const tools = bucket.get(category) || []
      const toolIds = tools.map((tool) => tool.id)
      const selectedCount = toolIds.filter((toolId) => selectedToolIds.includes(toolId)).length
      return {
        category,
        label: resolveToolCategoryLabel(category, t),
        tools,
        toolIds,
        selectedCount,
      }
    }).filter((group) => group.tools.length > 0)
  }, [availableTools, selectedToolIds, t])


  const selectedSkills = useMemo(
    () => availableSkills.filter((skill) => selectedSkillIds.includes(skill.id)),
    [availableSkills, selectedSkillIds]
  )

  const selectedTools = useMemo(
    () => availableTools.filter((tool) => selectedToolIds.includes(tool.id)),
    [availableTools, selectedToolIds]
  )

  function toggleSkill(skillId: string) {
    const newIds = selectedSkillIds.includes(skillId)
      ? selectedSkillIds.filter((item) => item !== skillId)
      : [...selectedSkillIds, skillId]
    setCapabilityPreferences(newIds, storeToolIds, true)
  }

  function toggleSkillDomain(skillIds: string[]) {
    if (skillIds.length === 0) return
    const allSelected = skillIds.every((skillId) => selectedSkillIds.includes(skillId))
    const newIds = allSelected
      ? selectedSkillIds.filter((skillId) => !skillIds.includes(skillId))
      : Array.from(new Set([...selectedSkillIds, ...skillIds]))
    setCapabilityPreferences(newIds, storeToolIds, true)
  }

  function toggleTool(toolId: string) {
    const newIds = selectedToolIds.includes(toolId)
      ? selectedToolIds.filter((item) => item !== toolId)
      : [...selectedToolIds, toolId]
    setCapabilityPreferences(storeSkillIds, newIds, true)
  }

  function toggleToolCategory(toolIds: string[]) {
    if (toolIds.length === 0) return
    const allSelected = toolIds.every((toolId) => selectedToolIds.includes(toolId))
    const newIds = allSelected
      ? selectedToolIds.filter((toolId) => !toolIds.includes(toolId))
      : Array.from(new Set([...selectedToolIds, ...toolIds]))
    setCapabilityPreferences(storeSkillIds, newIds, true)
  }

  function resetSkillDefaults() {
    setCapabilityPreferences(defaultSelectedSkillIds, storeToolIds, true)
  }

  function resetToolDefaults() {
    setCapabilityPreferences(storeSkillIds, defaultSelectedToolIds, true)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_360px]">
      <Card className="border-border/70 bg-card/85 shadow-[0_30px_90px_-45px_rgba(34,211,238,0.25)] dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">{t('capabilitySettingsNav')}</div>
          <CardTitle className="mt-1 text-2xl">{t('capabilitySettingsTitle')}</CardTitle>
          <CardDescription className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t('capabilitySettingsIntro')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{t('capabilitySettingsSectionTitle')}</p>
              <button
                type="button"
                title={t('skillVsToolSkillHelp')}
                className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-white/5"
              >
                {t('skillShortLabel')}
              </button>
              <button
                type="button"
                title={t('skillVsToolToolHelp')}
                className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-white/5"
              >
                {t('toolShortLabel')}
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('skillSelectionHelp')}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('toolSelectionHelp')}</p>
            <p className="mt-3 text-xs text-muted-foreground">{t('capabilitySelectionDefaultNotice')}</p>
          </div>

          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('loadedSkillsTitle')}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t('loadedSkillsHint')}</div>
              </div>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={resetSkillDefaults}>
                {t('useDefaultSkillSelection')}
              </Button>
            </div>
            {selectedSkills.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noSkillsSelected')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs dark:border-white/10 dark:bg-black/20"
                  >
                    <span className="font-medium text-foreground">{locale === 'zh' ? (skill.name.zh || skill.id) : (skill.name.en || skill.id)}</span>
                    <span className="text-muted-foreground">{resolveSkillDomainLabel(skillDomainById[skill.id] || 'unknown', t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('loadedToolsTitle')}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t('loadedToolsHint')}</div>
              </div>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={resetToolDefaults}>
                {t('useDefaultToolSelection')}
              </Button>
            </div>
            {selectedTools.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('loadedToolsEmpty')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedTools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs dark:border-white/10 dark:bg-black/20"
                  >
                    <span className="font-medium text-foreground">{resolveToolLabel(tool, locale)}</span>
                    <span className="text-muted-foreground">{resolveToolCategoryLabel(normalizeToolCategory(tool.category), t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-foreground">{t('skillSelectionDomainViewLabel')}</p>
            </div>
            <div className="space-y-3">
              {groupedSkills.filter((group) => group.skills.length > 0).length === 0 && (
                <p className="text-xs text-muted-foreground">{t('skillDomainNoInstalledSkills')}</p>
              )}
              {groupedSkills.filter((group) => group.skills.length > 0).map((group) => {
                const allSelected = group.skills.length > 0 && group.selectedCount === group.skills.length
                return (
                  <div key={group.domain} className="rounded-2xl border border-border/70 bg-background/70 p-3 dark:border-white/10 dark:bg-black/20">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">
                        {group.label}
                        <span className="ml-2 text-muted-foreground">{group.selectedCount}/{group.skills.length}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleSkillDomain(group.skillIds)}
                        disabled={group.skillIds.length === 0}
                        className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-white/5"
                      >
                        {allSelected ? t('skillClearDomainSelection') : t('skillSelectDomainSelection')}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.skills.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t('skillDomainNoInstalledSkills')}</p>
                      )}
                      {group.skills.map((skill) => {
                        const label = locale === 'zh' ? (skill.name.zh || skill.id) : (skill.name.en || skill.id)
                        const selected = selectedSkillIds.includes(skill.id)
                        return (
                          <button
                            key={skill.id}
                            type="button"
                            onClick={() => toggleSkill(skill.id)}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-sm transition',
                              selected
                                ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-700 dark:text-cyan-100'
                                : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-slate-950/40 dark:hover:text-white'
                            )}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 dark:border-white/10 dark:bg-white/5">
            <div className="mb-3">
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('toolSelectionLabel')}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t('toolSelectionHelp')}</div>
            </div>
            <div className="space-y-2">
              {groupedTools.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('toolSelectionEmpty')}</p>
              )}
              {groupedTools.map((group) => {
                const allSelected = group.tools.length > 0 && group.selectedCount === group.tools.length
                return (
                  <div key={group.category} className="rounded-xl border border-border/70 bg-background/70 p-3 dark:border-white/10 dark:bg-black/20">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">
                        {group.label}
                        <span className="ml-2 text-muted-foreground">{group.selectedCount}/{group.tools.length}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleToolCategory(group.toolIds)}
                        disabled={group.toolIds.length === 0}
                        className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-white/5"
                      >
                        {allSelected ? t('toolClearCategorySelection') : t('toolSelectCategorySelection')}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.tools.map((tool) => {
                        const selected = selectedToolIds.includes(tool.id)
                        const description = locale === 'zh' ? tool.description?.zh : tool.description?.en
                        return (
                          <button
                            key={tool.id}
                            type="button"
                            title={description || tool.id}
                            onClick={() => toggleTool(tool.id)}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-sm transition',
                              selected
                                ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-700 dark:text-cyan-100'
                                : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-slate-950/40 dark:hover:text-white'
                            )}
                          >
                            {resolveToolLabel(tool, locale)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/85 dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <CardTitle className="text-lg">{t('capabilitySettingsSidebarTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>{t('capabilitySettingsSidebarLine1')}</p>
          <p>{t('capabilitySettingsSidebarLine2')}</p>
          <p>{t('capabilitySettingsSidebarLine3')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
