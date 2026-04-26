import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

describe("memory tool conversation scope", () => {
  let prisma;

  beforeAll(async () => {
    const dbMod = await import("../../../dist/utils/database.js");
    prisma = dbMod.prisma;

    const tables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory_entries'`;
    if (tables.length === 0) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE agent_memory_entries (
          id TEXT NOT NULL PRIMARY KEY,
          scopeType TEXT NOT NULL,
          scopeId TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX agent_memory_entries_scopeType_scopeId_key_idx ON agent_memory_entries(scopeType, scopeId, key)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX agent_memory_entries_scopeType_scopeId_updatedAt_idx ON agent_memory_entries(scopeType, scopeId, updatedAt)`);
    }
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
    )).rejects.toThrow(/Conversation-scoped memory requires a conversation thread_id/);
  });
});

describe("memory tool workspace scope", () => {
  let tmpDir;
  let tool;

  beforeAll(async () => {
    const { createMemoryTool } = await import("../../../dist/agent-langgraph/memory-tool.js");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-tool-ws-"));
    tool = createMemoryTool(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("stores and retrieves workspace memory without thread_id", async () => {
    const storeRaw = await tool.invoke(
      { action: "store", key: "default.code", value: { code: "GB50010" }, scope: "workspace" },
      { configurable: {} },
    );
    const storeResult = JSON.parse(storeRaw);
    expect(storeResult.success).toBe(true);
    expect(storeResult.entry.scopeType).toBe("workspace");
    expect(storeResult.entry.scopeId).toBe("default");

    const retrieveRaw = await tool.invoke(
      { action: "retrieve", key: "default.code", scope: "workspace" },
      { configurable: {} },
    );
    const retrieveResult = JSON.parse(retrieveRaw);
    expect(retrieveResult.entry.value).toEqual({ code: "GB50010" });
  });

  test("lists workspace entries", async () => {
    const listRaw = await tool.invoke(
      { action: "list", scope: "workspace" },
      { configurable: {} },
    );
    const listResult = JSON.parse(listRaw);
    expect(listResult.success).toBe(true);
    expect(listResult.entries.length).toBeGreaterThanOrEqual(1);
  });

  test("deletes workspace entry", async () => {
    await tool.invoke(
      { action: "store", key: "to.delete", value: { x: 1 }, scope: "workspace" },
      { configurable: {} },
    );
    const deleteRaw = await tool.invoke(
      { action: "delete", key: "to.delete", scope: "workspace" },
      { configurable: {} },
    );
    const deleteResult = JSON.parse(deleteRaw);
    expect(deleteResult.deleted).toBe(true);
  });

  test("defaults to conversation scope when scope omitted", async () => {
    const { createMemoryTool } = await import("../../../dist/agent-langgraph/memory-tool.js");
    const convTool = createMemoryTool();
    await expect(convTool.invoke(
      { action: "list" },
      { configurable: {} },
    )).rejects.toThrow(/Conversation-scoped memory requires a conversation thread_id/);
  });
});
