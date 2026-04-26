import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

describe("memory tool conversation scope", () => {
  let prisma;

  beforeAll(async () => {
    const dbMod = await import("../../../dist/utils/database.js");
    prisma = dbMod.prisma;
  });

  afterAll(async () => {
    await prisma.agentMemoryEntry.deleteMany({
      where: { scopeType: "conversation", scopeId: "memory-tool-conv" },
    });
  });

  test("stores and retrieves memory using LangGraph thread_id", async () => {
    const { createMemoryTool } = await import("../../../dist/agent-langgraph/memory-tool.js");
    const tool = createMemoryTool();

    const storeRaw = await tool.invoke(
      { action: "store", key: "design.code", value: { code: "GB50017" } },
      { configurable: { thread_id: "memory-tool-conv" } },
    );
    const storeResult = JSON.parse(storeRaw);
    expect(storeResult.success).toBe(true);
    expect(storeResult.entry.scopeType).toBe("conversation");
    expect(storeResult.entry.scopeId).toBe("memory-tool-conv");

    const retrieveRaw = await tool.invoke(
      { action: "retrieve", key: "design.code" },
      { configurable: { thread_id: "memory-tool-conv" } },
    );
    const retrieveResult = JSON.parse(retrieveRaw);
    expect(retrieveResult.entry.value).toEqual({ code: "GB50017" });
  });

  test("returns a clear error when no conversation thread is available", async () => {
    const { createMemoryTool } = await import("../../../dist/agent-langgraph/memory-tool.js");
    const tool = createMemoryTool();

    await expect(tool.invoke(
      { action: "list" },
      { configurable: {} },
    )).rejects.toThrow(/Persistent memory requires a conversation thread_id/);
  });
});
