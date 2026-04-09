import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';

export interface FramePatchSources {
  message: string;
  existingState?: DraftState;
  naturalPatch?: DraftExtraction | null;
  llmPatch?: DraftExtraction | null;
}
