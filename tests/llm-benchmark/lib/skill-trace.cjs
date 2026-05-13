/**
 * Extract skill match results from Agent messages by parsing
 * detect_structure_type tool result messages.
 *
 * LangGraph stores tool results as ToolMessage objects in state.messages.
 * These have msg.name === 'detect_structure_type' and msg.content as JSON.
 *
 * @param {unknown[]} messages - state.messages from AgentState
 * @returns {{ skillId: string|null, structureType: string|null, mappedType: string|null } | null}
 */
function extractSkillTrace(messages) {
  if (!Array.isArray(messages)) return null;

  // Scan from end to find the most recent routing decision (important for multi-turn)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;

    // LangChain ToolMessage: msg.name === tool name
    if (msg.name !== 'detect_structure_type') continue;

    try {
      const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
      if (content && typeof content === 'object') {
        return {
          skillId: content.skillId || null,
          structureType: content.key || null,
          mappedType: content.mappedType || null,
        };
      }
    } catch {
      // ignore JSON parse errors; continue to next message
    }
  }

  return null;
}

module.exports = { extractSkillTrace };
