import { type StateCreator } from 'zustand'
import { loadCapabilityPreferences, saveCapabilityPreferences } from '../../capability-preference'

export type AppLocale = 'en' | 'zh'
export type WorkspaceSettingsTab = 'general' | 'capabilities' | 'llm' | 'database'

/**
 * Preferences State Interface
 *
 * Note: Theme persistence is handled by next-themes (see src/app/providers.tsx).
 * next-themes provides:
 * - localStorage persistence
 * - Cross-tab sync via browser 'storage' event
 * - System preference detection
 *
 * Capability preferences (selectedSkillIds, selectedToolIds) are persisted to
 * localStorage via saveCapabilityPreferences and hydrated on store creation.
 */
export interface PreferencesState {
  locale: AppLocale
  workspaceSettingsOpen: boolean
  workspaceSettingsTab: WorkspaceSettingsTab
  capabilitySkillIds: string[]
  capabilityToolIds: string[]
  capabilityExplicit: boolean
}

export interface PreferencesActions {
  setLocale: (locale: AppLocale) => void
  openWorkspaceSettings: (tab?: WorkspaceSettingsTab) => void
  closeWorkspaceSettings: () => void
  setCapabilityPreferences: (skillIds: string[], toolIds: string[], explicit: boolean) => void
}

export type PreferencesSlice = PreferencesState & PreferencesActions

function hydrateCapabilityPreferences(): { skillIds: string[]; toolIds: string[] } {
  const stored = loadCapabilityPreferences()
  if (stored) {
    return { skillIds: stored.skillIds, toolIds: stored.toolIds }
  }
  return { skillIds: [], toolIds: [] }
}

export function createInitialPreferencesState(): PreferencesState {
  const initialCapabilities = hydrateCapabilityPreferences()
  return {
    locale: 'en',
    workspaceSettingsOpen: false,
    workspaceSettingsTab: 'general',
    capabilitySkillIds: initialCapabilities.skillIds,
    capabilityToolIds: initialCapabilities.toolIds,
    capabilityExplicit: initialCapabilities.skillIds.length > 0 || initialCapabilities.toolIds.length > 0,
  }
}

export const initialPreferencesState: PreferencesState = createInitialPreferencesState()

export const createPreferencesSlice: StateCreator<
  PreferencesSlice,
  [],
  [],
  PreferencesSlice
> = (set) => ({
  ...createInitialPreferencesState(),
  setLocale: (locale) => set({ locale }),
  openWorkspaceSettings: (tab = 'general') => set({
    workspaceSettingsOpen: true,
    workspaceSettingsTab: tab,
  }),
  closeWorkspaceSettings: () => set({ workspaceSettingsOpen: false }),
  setCapabilityPreferences: (skillIds, toolIds, explicit) => {
    saveCapabilityPreferences({ skillIds, toolIds })
    set({ capabilitySkillIds: skillIds, capabilityToolIds: toolIds, capabilityExplicit: explicit })
  },
})
