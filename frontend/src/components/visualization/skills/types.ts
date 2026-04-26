import type { ComponentType, ReactNode } from 'react'
import type { MessageKey } from '@/lib/i18n'
import type {
  VisualizationCase,
  VisualizationExtensionId,
  VisualizationSnapshot,
  VisualizationViewMode,
} from '../types'

export type SkillAvailability =
  | { ok: true }
  | { ok: false; reasonKey: MessageKey }

export type SkillCategory = 'metric' | 'shape' | 'interaction'

export type SkillStateApi = {
  get: <T>(key: string, fallback: T) => T
  set: <T>(key: string, value: T) => void
  use: <T>(key: string, fallback: T) => [T, (value: T) => void]
}

export type SkillActions = {
  setView: (view: VisualizationViewMode) => void
  selectElement: (elementId: string | null) => void
}

export type SkillRenderContext = {
  snapshot: VisualizationSnapshot
  activeCase: VisualizationCase
  activeView: VisualizationViewMode
  locale: 'zh' | 'en'
  t: (key: MessageKey) => string
  state: SkillStateApi
  actions: SkillActions
}

export type SceneContribution = {
  memberColor?: (elementId: string, ctx: SkillRenderContext) => string | null
  memberTransform?: (
    elementId: string,
    ctx: SkillRenderContext
  ) => { positions?: [number, number, number][]; scale?: number } | null
  frameloop?: 'always' | 'demand'
  r3fOverlay?: ComponentType<{ ctx: SkillRenderContext }>
}

export type SkillRenderer = {
  id: VisualizationExtensionId | string
  view: VisualizationViewMode
  viewLabelKey: MessageKey
  descriptionKey?: MessageKey
  category: SkillCategory
  schemaVersion: number
  isAvailable: (snapshot: VisualizationSnapshot | null) => SkillAvailability
  renderAside?: (ctx: SkillRenderContext) => ReactNode
  renderLegend?: (ctx: SkillRenderContext) => ReactNode
  renderToolbarItem?: (ctx: SkillRenderContext) => ReactNode
  scene?: SceneContribution
  onActivate?: (ctx: SkillRenderContext) => void
  onDeactivate?: (ctx: SkillRenderContext) => void
}

export type SkillSchemaValidator<TData = unknown> = (raw: unknown) =>
  | { ok: true; data: TData }
  | { ok: false; reasonKey: MessageKey }

export type SkillContract<TData = unknown> = {
  id: VisualizationExtensionId | string
  schemaVersion: number
  validate: SkillSchemaValidator<TData>
}
