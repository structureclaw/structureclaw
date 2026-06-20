import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';

export interface FramePatchSources {
  existingState?: DraftState;
  supplementalPatch?: DraftExtraction | null;
  llmPatch?: DraftExtraction | null;
}
