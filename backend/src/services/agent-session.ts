import { cache } from '../utils/cache.js';
import type { InteractionSession } from './agent.js';
import type { SessionState } from './agent-context.js';

const SESSION_TTL_SECONDS = 30 * 60;

const ALLOWED_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ['collecting', 'drafted', 'executing'],
  collecting: ['collecting', 'drafted', 'idle'],
  drafted: ['validating', 'ready', 'collecting', 'idle'],
  validating: ['ready', 'validation_failed', 'blocked'],
  validation_failed: ['validating', 'collecting', 'blocked'],
  ready: ['executing', 'collecting', 'idle'],
  executing: ['completed', 'blocked'],
  completed: ['idle', 'collecting'],
  blocked: ['idle', 'collecting'],
};

export function getSessionState(session: InteractionSession): SessionState {
  return session.state ?? 'idle';
}

export function transitionSession(
  session: InteractionSession,
  to: SessionState,
  reason?: string,
): void {
  const from = getSessionState(session);
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    throw new Error(`Invalid session transition: ${from} → ${to}`);
  }
  session.state = to;
  session.stateReason = reason;
  session.updatedAt = Date.now();
}

export function buildInteractionSessionKey(conversationId: string): string {
  return `agent:interaction-session:${conversationId}`;
}

export async function getInteractionSession(
  conversationId: string | undefined,
): Promise<InteractionSession | undefined> {
  if (!conversationId) {
    return undefined;
  }

  try {
    const raw = await cache.get(buildInteractionSessionKey(conversationId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.draft) {
        return parsed as InteractionSession;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function setInteractionSession(
  conversationId: string,
  session: InteractionSession,
): Promise<void> {
  try {
    await cache.setex(
      buildInteractionSessionKey(conversationId),
      SESSION_TTL_SECONDS,
      JSON.stringify(session),
    );
  } catch {
    // Keep non-blocking behavior for session persistence.
  }
}

export async function clearInteractionSession(
  conversationId: string,
): Promise<void> {
  try {
    await cache.del(buildInteractionSessionKey(conversationId));
  } catch {
    // Keep non-blocking behavior for session cleanup.
  }
}
