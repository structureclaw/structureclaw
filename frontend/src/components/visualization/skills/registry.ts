import {
  visualizationExtensionRegistry,
  getAvailableVisualizationExtensions,
  getVisualizationExtensionByView,
  getVisualizationViewLabelKey,
} from '../extensions'

export {
  visualizationExtensionRegistry as legacyExtensionRegistry,
  getAvailableVisualizationExtensions,
  getVisualizationExtensionByView,
  getVisualizationViewLabelKey,
}

export const visualizationSkillRegistry: ReadonlyArray<never> = []
