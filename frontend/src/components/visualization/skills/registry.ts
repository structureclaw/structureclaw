import {
  getVisualizationExtensionByView,
  getVisualizationViewLabelKey,
} from '../extensions'
import type { SkillRenderer } from './types'

export {
  getVisualizationExtensionByView,
  getVisualizationViewLabelKey,
}

export const visualizationSkillRegistry: ReadonlyArray<SkillRenderer> = []
