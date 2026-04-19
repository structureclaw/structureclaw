'use client'

export type SkillDomain =
  | 'analysis'
  | 'code-check'
  | 'data-input'
  | 'design'
  | 'drawing'
  | 'general'
  | 'load-boundary'
  | 'material'
  | 'report-export'
  | 'result-postprocess'
  | 'section'
  | 'structure-type'
  | 'validation'
  | 'visualization'
  | 'unknown'

export const ALL_SKILL_DOMAINS: SkillDomain[] = [
  'data-input',
  'structure-type',
  'material',
  'section',
  'load-boundary',
  'analysis',
  'result-postprocess',
  'design',
  'code-check',
  'validation',
  'report-export',
  'drawing',
  'visualization',
  'general',
]

export type SkillMetadataLike = {
  id: string
  domain?: unknown
  aliases?: unknown
}

export type CapabilityMatrixSkillLike = {
  id: string
  domain?: unknown
}

export type SkillNormalizationMatrixLike = {
  skills?: CapabilityMatrixSkillLike[]
  skillDomainById?: Record<string, unknown>
  canonicalSkillIdByAlias?: Record<string, unknown>
  skillAliasesByCanonicalId?: Record<string, unknown>
}

export type SkillNormalizationContext = {
  skillDomainById: Record<string, SkillDomain>
  resolveCanonicalSkillId: (skillId: string) => string
  normalizeSkillIds: (skillIds: string[]) => string[]
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

export function normalizeSkillDomain(value: unknown): SkillDomain {
  const raw = typeof value === 'string' ? value : ''
  if (ALL_SKILL_DOMAINS.includes(raw as SkillDomain)) {
    return raw as SkillDomain
  }
  if (raw === 'analysis-strategy') return 'analysis'
  if (raw === 'generic-fallback') return 'general'
  if (raw === 'geometry-input') return 'data-input'
  if (raw === 'material-constitutive') return 'material'
  return 'unknown'
}

function registerAlias(
  aliasMap: Record<string, string>,
  alias: string,
  canonicalSkillId: string
) {
  const trimmedAlias = alias.trim()
  const trimmedCanonicalSkillId = canonicalSkillId.trim()
  if (!trimmedAlias || !trimmedCanonicalSkillId || aliasMap[trimmedAlias]) {
    return
  }
  aliasMap[trimmedAlias] = trimmedCanonicalSkillId
}

export function buildSkillNormalizationContext(
  availableSkills: SkillMetadataLike[],
  capabilityMatrix: SkillNormalizationMatrixLike | null
): SkillNormalizationContext {
  const skillDomainById: Record<string, SkillDomain> = {}
  const canonicalSkillIdByAlias: Record<string, string> = {}
  const canonicalSkillIds = new Set<string>()
  const availableSkillById = new Map<string, SkillMetadataLike>()
  const matrixSkillById = new Map<string, CapabilityMatrixSkillLike>()

  availableSkills.forEach((skill) => {
    if (skill && typeof skill.id === 'string' && skill.id.trim().length > 0) {
      availableSkillById.set(skill.id, skill)
      canonicalSkillIds.add(skill.id)
    }
  })

  const matrixSkills = Array.isArray(capabilityMatrix?.skills) ? capabilityMatrix.skills : []
  matrixSkills.forEach((skill) => {
    if (skill && typeof skill.id === 'string' && skill.id.trim().length > 0) {
      matrixSkillById.set(skill.id, skill)
      canonicalSkillIds.add(skill.id)
    }
  })

  const matrixCanonicalByAlias = capabilityMatrix?.canonicalSkillIdByAlias
  if (matrixCanonicalByAlias && typeof matrixCanonicalByAlias === 'object') {
    Object.entries(matrixCanonicalByAlias).forEach(([alias, canonicalSkillId]) => {
      if (typeof alias === 'string' && typeof canonicalSkillId === 'string') {
        registerAlias(canonicalSkillIdByAlias, alias, canonicalSkillId)
      }
    })
  }

  const matrixAliasesByCanonicalId = capabilityMatrix?.skillAliasesByCanonicalId
  if (matrixAliasesByCanonicalId && typeof matrixAliasesByCanonicalId === 'object') {
    Object.entries(matrixAliasesByCanonicalId).forEach(([canonicalSkillId, aliases]) => {
      if (typeof canonicalSkillId !== 'string') {
        return
      }
      normalizeStringArray(aliases).forEach((alias) => registerAlias(canonicalSkillIdByAlias, alias, canonicalSkillId))
    })
  }

  availableSkills.forEach((skill) => {
    normalizeStringArray(skill.aliases).forEach((alias) => registerAlias(canonicalSkillIdByAlias, alias, skill.id))
  })

  const allSkillIds = new Set<string>([
    ...availableSkillById.keys(),
    ...matrixSkillById.keys(),
    ...Object.keys(capabilityMatrix?.skillDomainById || {}),
  ])

  allSkillIds.forEach((skillId) => {
    const matrixDomain = capabilityMatrix?.skillDomainById?.[skillId]
    if (matrixDomain !== undefined) {
      skillDomainById[skillId] = normalizeSkillDomain(matrixDomain)
      return
    }

    const matrixSkill = matrixSkillById.get(skillId)
    if (matrixSkill?.domain !== undefined) {
      skillDomainById[skillId] = normalizeSkillDomain(matrixSkill.domain)
      return
    }

    const availableSkill = availableSkillById.get(skillId)
    if (availableSkill?.domain !== undefined) {
      skillDomainById[skillId] = normalizeSkillDomain(availableSkill.domain)
      return
    }

    if (skillId.startsWith('code-check-')) {
      skillDomainById[skillId] = 'code-check'
      return
    }

    skillDomainById[skillId] = 'unknown'
  })

  function resolveCanonicalSkillId(skillId: string) {
    const trimmedSkillId = skillId.trim()
    if (!trimmedSkillId) {
      return skillId
    }
    if (canonicalSkillIds.has(trimmedSkillId)) {
      return trimmedSkillId
    }
    return canonicalSkillIdByAlias[trimmedSkillId] || trimmedSkillId
  }

  function normalizeSkillIds(skillIds: string[]) {
    const canonicalIds: string[] = []
    const seen = new Set<string>()

    skillIds.forEach((skillId) => {
      const canonicalSkillId = resolveCanonicalSkillId(skillId)
      if (!canonicalSkillId || seen.has(canonicalSkillId)) {
        return
      }
      seen.add(canonicalSkillId)
      canonicalIds.push(canonicalSkillId)
    })

    return canonicalIds
  }

  return {
    skillDomainById,
    resolveCanonicalSkillId,
    normalizeSkillIds,
  }
}

export const DEFAULT_CONSOLE_SKILL_IDS = [
  'opensees-static',
  'generic',
  'validation-structure-model',
  'report-export-builtin',
] as const
