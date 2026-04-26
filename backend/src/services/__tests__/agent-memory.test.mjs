import { describe, expect, test, beforeAll, afterAll } from "@jest/globals";

describe("AgentMemoryService", () => {
  let service;
  let prisma;

  beforeAll(async () => {
    const serviceMod = await import("../../../dist/services/agent-memory.js");
    const dbMod = await import("../../../dist/utils/database.js");
    service = new serviceMod.AgentMemoryService();
    prisma = dbMod.prisma;
  });

  afterAll(async () => {
    await prisma.agentMemoryEntry.deleteMany({
      where: { scopeType: "conversation", scopeId: "memory-test-conv" },
    });
  });

  test("stores and retrieves a scoped memory value", async () => {
    const scope = { scopeType: "conversation", scopeId: "memory-test-conv" };
    await service.store(scope, "design.code", { code: "GB50017" });
    const entry = await service.retrieve(scope, "design.code");

    expect(entry.key).toBe("design.code");
    expect(entry.value).toEqual({ code: "GB50017" });
  });

  test("rejects invalid keys", async () => {
    await expect(service.store(
      { scopeType: "conversation", scopeId: "memory-test-conv" },
      "../bad",
      { value: true },
    ))
      .rejects.toThrow(/Invalid memory key/);
  });
});
