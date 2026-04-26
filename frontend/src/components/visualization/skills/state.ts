'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import type { SkillStateApi } from './types'

type SkillStateStore = {
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
}

const skillStateStore = createStore<SkillStateStore>((set) => ({
  values: {},
  setValue: (key, value) =>
    set((prev) => {
      if (prev.values[key] === value) return prev
      return { ...prev, values: { ...prev.values, [key]: value } }
    }),
}))

function namespaced(skillId: string, key: string): string {
  return `${skillId}::${key}`
}

function readValue<T>(fullKey: string, fallback: T): T {
  const stored = skillStateStore.getState().values[fullKey]
  return stored === undefined ? fallback : (stored as T)
}

export function useSkillStateValue<T>(
  skillId: string,
  key: string,
  fallback: T
): [T, (value: T) => void] {
  const fullKey = namespaced(skillId, key)
  const value = useSyncExternalStore(
    skillStateStore.subscribe,
    () => readValue(fullKey, fallback),
    () => fallback
  )
  const setter = useCallback(
    (next: T) => skillStateStore.getState().setValue(fullKey, next),
    [fullKey]
  )
  return [value, setter]
}

export function useSkillState(skillId: string): SkillStateApi {
  // 订阅整个 values map：任何 skill 的状态变化都会让消费者重渲染。
  // 这里允许跨 skill 的"过度重渲染"，因为 step 1 还没有任何 skill 注册；
  // 需要细粒度订阅时使用 useSkillStateValue。
  useSyncExternalStore(
    skillStateStore.subscribe,
    () => skillStateStore.getState().values,
    () => skillStateStore.getState().values
  )

  return useMemo<SkillStateApi>(
    () => ({
      get: <T,>(key: string, fallback: T): T => readValue(namespaced(skillId, key), fallback),
      set: <T,>(key: string, value: T): void => {
        skillStateStore.getState().setValue(namespaced(skillId, key), value)
      },
    }),
    [skillId]
  )
}

export function __resetSkillStateForTest(): void {
  const setter = skillStateStore.getState().setValue
  skillStateStore.setState({ values: {}, setValue: setter })
}
