'use client'

import { createContext, useContext, useRef, type ReactNode } from 'react'
import { type StoreApi, useStore as useZustandStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  createPreferencesSlice,
  type PreferencesSlice,
  initialPreferencesState,
} from './slices/preferences'

export type StoreState = PreferencesSlice

/**
 * Initialize the store with default state values.
 * Used to create initial state for new store instances.
 * Returns only state values (not actions) for merging with slices.
 */
export const initStore = (): Partial<StoreState> => {
  return {
    ...initialPreferencesState,
  }
}

/**
 * Create a new Zustand store instance.
 * Each call creates a fresh store - critical for SSR safety.
 * @param initState - Optional initial state to override defaults (state values only, not actions)
 */
export const createAppStore = (initState?: Partial<StoreState>) => {
  return createStore<StoreState>()((set, get, store) => ({
    ...createPreferencesSlice(set, get, store),
    ...(initState || {}),
  }))
}

export const AppStoreContext = createContext<StoreApi<StoreState> | null>(null)

export interface AppStoreProviderProps {
  children: ReactNode
  initialState?: Partial<StoreState>
}

/**
 * Provider component that creates and holds a store instance.
 * Uses useRef to ensure the store is created once per provider mount.
 * Each provider instance gets its own store - preventing SSR state leakage.
 */
export const AppStoreProvider = ({ children, initialState }: AppStoreProviderProps) => {
  const storeRef = useRef<StoreApi<StoreState>>()
  if (!storeRef.current) {
    storeRef.current = createAppStore(initialState)
  }

  return (
    <AppStoreContext.Provider value={storeRef.current}>
      {children}
    </AppStoreContext.Provider>
  )
}

/**
 * Hook to access store state with selector.
 * Throws a clear error if used outside AppStoreProvider.
 * @param selector - Function to select desired state slice
 * @returns Selected state value
 */
export const useStore = <T,>(selector: (store: StoreState) => T): T => {
  const appStoreContext = useContext(AppStoreContext)

  if (!appStoreContext) {
    throw new Error('useStore must be used within AppStoreProvider')
  }

  return useZustandStore(appStoreContext, selector)
}
