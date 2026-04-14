import { describe, expect, test } from '@jest/globals';

const hasLlmKey = !!process.env.LLM_API_KEY;

const describeLlm = hasLlmKey ? describe : describe.skip;

describeLlm('Agent real LLM integration', () => {
  const serviceUrl = new URL('../dist/services/agent.js', import.meta.url).href;

  async function createAgentService() {
    const { AgentService } = await import(`${serviceUrl}?llm-test=${Date.now()}`);
    return new AgentService();
  }

  test('runs a chat-only request with real LLM and returns structured result', async () => {
    const agent = await createAgentService();
    const result = await agent.runChatOnly({
      message: 'Explain the difference between dead load and live load in structural design',
      context: { skillIds: ['generic'] },
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(Array.isArray(result.plan)).toBe(true);
  }, 60_000);

  test('streams a chat response with real LLM', async () => {
    const agent = await createAgentService();
    const chunks = [];

    for await (const chunk of agent.runChatOnlyStream({
      message: 'What is a simply supported beam?',
      context: { skillIds: ['generic'] },
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    // Stream should contain start and result/done chunks
    const types = chunks.map((c) => c.type);
    expect(types).toContain('start');
    expect(types).toContain('result');
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
