import {
  visualizationExtensionRegistry,
  getAvailableVisualizationExtensions,
  getVisualizationExtensionByView,
  getVisualizationViewLabelKey,
} from '../extensions'
import type { SkillRenderer } from './types'

export {
  visualizationExtensionRegistry as legacyExtensionRegistry,
  getAvailableVisualizationExtensions,
  getVisualizationExtensionByView,
  getVisualizationViewLabelKey,
}

export const visualizationSkillRegistry: ReadonlyArray<SkillRenderer> = []
