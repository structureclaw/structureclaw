'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { API_BASE } from '@/lib/api-base'
import { loadCapabilityPreferences, saveCapabilityPreferences } from '@/lib/capability-preference'
import { ALL_SKILL_DOMAINS, buildSkillNormalizationContext, type SkillDomain, type SkillMetadataLike } from '@/lib/skill-normalization'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import { cn } from '@/lib/utils'

type AgentSkillSummary = SkillMetadataLike & {
  name: { zh?: string; en?: string }
  description: { zh?: string; en?: string }
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
  foundationToolIds?: string[]
  enabledToolIdsBySkill?: Record<string, string[]>
  canonicalSkillIdByAlias?: Record<string, string>
  skillAliasesByCanonicalId?: Record<string, string[]>
}

const ALL_TOOL_CATEGORIES: ToolCategory[] = ['modeling', 'analysis', 'code-check', 'report', 'utility']

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

function resolveCallableTools(
  matrix: CapabilityMatrixPayload | null,
  selectedSkillIds: string[],
  skillDomainById: Record<string, SkillDomain>,
) {
  const matrixTools = Array.isArray(matrix?.tools) ? matrix.tools : []
  const foundationToolIds = new Set(Array.isArray(matrix?.foundationToolIds) ? matrix.foundationToolIds : [])
  const enabledToolIdsBySkill = matrix?.enabledToolIdsBySkill && typeof matrix.enabledToolIdsBySkill === 'object'
    ? matrix.enabledToolIdsBySkill
    : {}
  if (Object.keys(enabledToolIdsBySkill).length === 0) {
    return matrixTools
  }
  const callableToolIds = new Set<string>(foundationToolIds)

  selectedSkillIds.forEach((skillId) => {
    const toolIds = enabledToolIdsBySkill[skillId]
    if (!Array.isArray(toolIds)) {
      if (skillDomainById[skillId] === 'structure-type') {
        callableToolIds.add('validate_model')
      }
      return
    }
    toolIds.forEach((toolId) => {
      if (typeof toolId === 'string' && toolId.trim().length > 0) {
        callableToolIds.add(toolId)
      }
    })
    if (skillDomainById[skillId] === 'structure-type') {
      callableToolIds.add('validate_model')
    }
  })

  const toolById = new Map(matrixTools.map((tool) => [tool.id, tool]))
  const queue = [...callableToolIds]
  while (queue.length > 0) {
    const toolId = queue.shift()
    if (!toolId) {
      continue
    }
    const tool = toolById.get(toolId)
    if (!tool || !Array.isArray(tool.requiresTools)) {
      continue
    }
    tool.requiresTools.forEach((requiredToolId) => {
      if (typeof requiredToolId !== 'string' || requiredToolId.trim().length === 0 || callableToolIds.has(requiredToolId)) {
        return
      }
      callableToolIds.add(requiredToolId)
      queue.push(requiredToolId)
    })
  }

  return matrixTools.filter((tool) => callableToolIds.has(tool.id))
}

function toToolIdList(tools: CapabilityToolSummary[]) {
  return tools.map((tool) => tool.id)
}

function hasSameIds(left: string[], right: string[]) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== rightSet.size) {
    return false
  }

  for (const item of leftSet) {
    if (!rightSet.has(item)) {
      return false
    }
  }

  return true
}

export function CapabilitySettingsPanel() {
  const { t, locale } = useI18n()
  const [availableSkills, setAvailableSkills] = useState<AgentSkillSummary[]>([])
  const [capabilityMatrix, setCapabilityMatrix] = useState<CapabilityMatrixPayload | null>(null)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([])
  const [skillDomainView, setSkillDomainView] = useState<SkillDomain>('structure-type')
  const preferencesHydratedRef = useRef(false)
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  const [capabilityMatrixLoaded, setCapabilityMatrixLoaded] = useState(false)

  const skillNormalization = useMemo(
    () => buildSkillNormalizationContext(availableSkills, capabilityMatrix),
    [availableSkills, capabilityMatrix]
  )
  const skillDomainById = skillNormalization.skillDomainById

  const availableTools = useMemo(() => {
    return [...resolveCallableTools(capabilityMatrix, selectedSkillIds, skillDomainById)]
      .sort((a, b) => resolveToolLabel(a, locale).localeCompare(resolveToolLabel(b, locale)))
  }, [capabilityMatrix, locale, selectedSkillIds, skillDomainById])

  const defaultSelectedSkillIds = useMemo(() => {
    const available = new Set(availableSkills.map((skill) => skill.id))
    return ['opensees-static', 'generic'].filter((skillId) => available.has(skillId))
  }, [availableSkills])

  const initialDefaultToolIds = useMemo(
    () => toToolIdList(resolveCallableTools(capabilityMatrix, defaultSelectedSkillIds, skillDomainById)),
    [capabilityMatrix, defaultSelectedSkillIds, skillDomainById]
  )

  const baseCallableToolIds = useMemo(
    () => toToolIdList(resolveCallableTools(capabilityMatrix, [], skillDomainById)),
    [capabilityMatrix, skillDomainById]
  )

  const defaultSelectedToolIds = useMemo(() => availableTools.map((tool) => tool.id), [availableTools])

  useEffect(() => {
    let active = true

    async function loadSkills() {
      const response = await fetch(`${API_BASE}/api/v1/agent/skills`)
      if (!response.ok) {
        if (active) setSkillsLoaded(true)
        return
      }
      const payload = await response.json()
      if (active && Array.isArray(payload)) {
        setAvailableSkills(payload as AgentSkillSummary[])
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

  useEffect(() => {
    if (preferencesHydratedRef.current) {
      return
    }
    if (!skillsLoaded || !capabilityMatrixLoaded) {
      return
    }
    const stored = loadCapabilityPreferences()
    if (stored) {
      const validSkillIds = skillNormalization.normalizeSkillIds(stored.skillIds)
        .filter((skillId) => availableSkills.some((skill) => skill.id === skillId))
      const resolvedTools = resolveCallableTools(capabilityMatrix, validSkillIds, skillDomainById)
      const validToolIds = stored.toolIds.filter((toolId) => resolvedTools.some((tool) => tool.id === toolId))
      const shouldRepairLegacyDefaultTools =
        hasSameIds(validSkillIds, defaultSelectedSkillIds)
        && hasSameIds(validToolIds, baseCallableToolIds)
        && initialDefaultToolIds.length > baseCallableToolIds.length

      setSelectedSkillIds(validSkillIds)
      setSelectedToolIds(shouldRepairLegacyDefaultTools ? initialDefaultToolIds : validToolIds)
    } else {
      setSelectedSkillIds(defaultSelectedSkillIds)
      setSelectedToolIds(initialDefaultToolIds)
    }
    preferencesHydratedRef.current = true
  }, [availableSkills, baseCallableToolIds, capabilityMatrixLoaded, defaultSelectedSkillIds, initialDefaultToolIds, skillDomainById, skillNormalization, skillsLoaded])

  useEffect(() => {
    if (!preferencesHydratedRef.current) {
      return
    }
    if (!skillsLoaded || !capabilityMatrixLoaded) {
      return
    }
    saveCapabilityPreferences({
      skillIds: skillNormalization.normalizeSkillIds(selectedSkillIds),
      toolIds: selectedToolIds,
    })
  }, [capabilityMatrixLoaded, selectedSkillIds, selectedToolIds, skillNormalization, skillsLoaded])

  const groupedSkills = useMemo(() => {
    const bucket = new Map<SkillDomain, AgentSkillSummary[]>()
    availableSkills.forEach((skill) => {
      const domain = skillDomainById[skill.id] || 'unknown'
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

  const visibleGroupedSkills = useMemo(
    () => groupedSkills.filter((group) => group.domain === skillDomainView),
    [groupedSkills, skillDomainView]
  )

  const selectedSkills = useMemo(
    () => availableSkills.filter((skill) => selectedSkillIds.includes(skill.id)),
    [availableSkills, selectedSkillIds]
  )

  const selectedTools = useMemo(
    () => availableTools.filter((tool) => selectedToolIds.includes(tool.id)),
    [availableTools, selectedToolIds]
  )

  function toggleSkill(skillId: string) {
    setSelectedSkillIds((current) => (
      current.includes(skillId)
        ? current.filter((item) => item !== skillId)
        : [...current, skillId]
    ))
  }

  function toggleSkillDomain(skillIds: string[]) {
    if (skillIds.length === 0) return
    setSelectedSkillIds((current) => {
      const allSelected = skillIds.every((skillId) => current.includes(skillId))
      if (allSelected) {
        return current.filter((skillId) => !skillIds.includes(skillId))
      }
      return Array.from(new Set([...current, ...skillIds]))
    })
  }

  function toggleTool(toolId: string) {
    setSelectedToolIds((current) => (
      current.includes(toolId)
        ? current.filter((item) => item !== toolId)
        : [...current, toolId]
    ))
  }

  function toggleToolCategory(toolIds: string[]) {
    if (toolIds.length === 0) return
    setSelectedToolIds((current) => {
      const allSelected = toolIds.every((toolId) => current.includes(toolId))
      return allSelected
        ? current.filter((toolId) => !toolIds.includes(toolId))
        : Array.from(new Set([...current, ...toolIds]))
    })
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
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setSelectedSkillIds(defaultSelectedSkillIds)}>
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
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setSelectedToolIds(defaultSelectedToolIds)}>
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
              <label className="text-xs font-medium text-foreground" htmlFor="capability-domain-view-select">{t('skillSelectionDomainViewLabel')}</label>
              <select
                id="capability-domain-view-select"
                value={skillDomainView}
                onChange={(event) => setSkillDomainView(event.target.value as SkillDomain)}
                className="h-9 min-w-[220px] rounded-md border border-border/70 bg-background px-3 text-xs text-foreground dark:border-white/10 dark:bg-black/20"
              >
                {groupedSkills.map((group) => (
                  <option key={group.domain} value={group.domain}>{group.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              {visibleGroupedSkills.map((group) => {
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
