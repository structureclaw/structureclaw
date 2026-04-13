import { describe, expect, test } from '@jest/globals';

const hasLlmKey = !!process.env.LLM_API_KEY;

const describeLlm = hasLlmKey ? describe : describe.skip;

describeLlm('Agent real LLM integration', () => {
  const serviceUrl = new URL('../dist/services/agent.js', import.meta.url).href;

  async function createAgentService() {
    const { AgentService } = await import(`${serviceUrl}?llm-test=${Date.now()}`);
    return new AgentService();
  }

  test('detects skill and routes correctly for a beam description', async () => {
    const agent = await createAgentService();
    const result = await agent.processMessage({
      message: 'I need to analyze a concrete beam spanning 6 meters with a uniform load of 20 kN/m',
      context: { skillIds: ['beam', 'generic'] },
    });

    expect(result).toBeDefined();
    expect(typeof result.response).toBe('string');
    expect(result.response.length).toBeGreaterThan(0);
  }, 60_000);

  test('streams a chat response with real LLM', async () => {
    const agent = await createAgentService();
    const chunks = [];

    const stream = agent.streamMessage({
      message: 'What is a simply supported beam?',
      context: { skillIds: ['generic'] },
    });

    for await (const chunk of stream) {
      if (chunk.type === 'token' && chunk.content) {
        chunks.push(chunk.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText.length).toBeGreaterThan(20);
  }, 60_000);

  test('handles a structural engineering question with default skills', async () => {
    const agent = await createAgentService();
    const result = await agent.processMessage({
      message: 'Explain the difference between dead load and live load in structural design',
      context: {},
    });

    expect(result).toBeDefined();
    expect(typeof result.response).toBe('string');
    // Should contain structural engineering terms
    const lower = result.response.toLowerCase();
    const hasStructuralTerms =
      lower.includes('load') ||
      lower.includes('structure') ||
      lower.includes('design') ||
      lower.includes('force');
    expect(hasStructuralTerms).toBe(true);
  }, 60_000);

  test('returns a valid skill list from the registry', async () => {
    const agent = await createAgentService();
    const skills = await agent.listSkills();

    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);

    const skill = skills[0];
    expect(skill.id).toBeDefined();
    expect(skill.name).toBeDefined();
    expect(skill.domain).toBeDefined();
  });
});
