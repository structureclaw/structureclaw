'use client'

export type CapabilityPreferenceState = {
  skillIds: string[]
  toolIds: string[]
}

export const CAPABILITY_PREFERENCE_STORAGE_KEY = 'structureclaw.console.capabilities'

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

export function loadCapabilityPreferences(): CapabilityPreferenceState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(CAPABILITY_PREFERENCE_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as { skillIds?: unknown; toolIds?: unknown }
    return {
      skillIds: normalizeStringArray(parsed?.skillIds),
      toolIds: normalizeStringArray(parsed?.toolIds),
    }
  } catch {
    return null
  }
}

export function saveCapabilityPreferences(preferences: CapabilityPreferenceState) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    CAPABILITY_PREFERENCE_STORAGE_KEY,
    JSON.stringify({
      skillIds: preferences.skillIds,
      toolIds: preferences.toolIds,
    })
  )
}
