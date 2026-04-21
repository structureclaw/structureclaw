/**
 * Shared SSE stream chunk types for the agent system.
 *
 * Extracted from the legacy AgentService so that the new LangGraph module
 * can import these without depending on the legacy orchestrator.
 */
import type {
  PresentationPhase,
  AssistantPresentation,
  ArtifactState,
  TimelineStepItem,
  TimelinePhaseGroup,
} from '../services/chat-presentation.js';

// ---------------------------------------------------------------------------
// Presentation chunks (emitted by the agent streaming layer)
// ---------------------------------------------------------------------------

export type PublicPresentationChunk =
  | { type: 'presentation_init'; presentation: AssistantPresentation }
  | { type: 'phase_upsert'; phase: TimelinePhaseGroup }
  | { type: 'step_upsert'; phaseId: string; step: TimelineStepItem }
  | { type: 'artifact_upsert'; artifact: ArtifactState }
  | {
      type: 'artifact_payload_sync';
      artifact: 'model' | 'analysis' | 'report';
      model?: Record<string, unknown>;
      latestResult?: Record<string, unknown>;
      snapshot?: Record<string, unknown>;
    }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; phase: PresentationPhase; message: string; createdAt?: string };

// ---------------------------------------------------------------------------
// Agent stream chunks (SSE event types sent to the frontend)
// ---------------------------------------------------------------------------

export type AgentStreamChunk =
  | { type: 'start'; content?: unknown }
  | { type: 'interaction_update'; content?: unknown }
  | { type: 'result'; content?: unknown }
  | { type: 'token'; content?: string }
  | { type: 'done' }
  | { type: 'error'; error?: string }
  | PublicPresentationChunk;

export type StepEventCallback = (chunk: AgentStreamChunk) => void;
