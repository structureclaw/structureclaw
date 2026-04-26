import { describe, expect, test, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

describe("AgentMemoryService", () => {
  let service;
  let prisma;

  beforeAll(async () => {
    const serviceMod = await import("../../../dist/services/agent-memory.js");
    const dbMod = await import("../../../dist/utils/database.js");
    service = new serviceMod.AgentMemoryService();
    prisma = dbMod.prisma;
  }, 15000);

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

describe("AgentMemoryFileStore", () => {
  let fileStore;
  let tmpDir;
  let normalizeMemoryKey;

  beforeAll(async () => {
    const mod = await import("../../../dist/services/agent-memory.js");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));
    fileStore = new mod.AgentMemoryFileStore(tmpDir);
    normalizeMemoryKey = mod.normalizeMemoryKey;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("stores and retrieves a value", async () => {
    const entry = await fileStore.store("design.code", { code: "GB50017" });
    expect(entry.scopeType).toBe("workspace");
    expect(entry.scopeId).toBe("default");
    expect(entry.key).toBe("design.code");
    expect(entry.value).toEqual({ code: "GB50017" });

    const retrieved = await fileStore.retrieve("design.code");
    expect(retrieved.value).toEqual({ code: "GB50017" });
  });

  test("returns null for missing key", async () => {
    const entry = await fileStore.retrieve("nonexistent");
    expect(entry).toBeNull();
  });

  test("lists entries sorted by updatedAt desc", async () => {
    await fileStore.store("alpha", { v: 1 });
    await fileStore.store("beta", { v: 2 });
    const entries = await fileStore.list();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // newest first
    expect(entries[0].key).toBe("beta");
    expect(entries[1].key).toBe("alpha");
  });

  test("deletes an entry", async () => {
    await fileStore.store("to.delete", { v: 1 });
    const deleted = await fileStore.delete("to.delete");
    expect(deleted).toBe(true);
    const entry = await fileStore.retrieve("to.delete");
    expect(entry).toBeNull();
  });

  test("delete returns false for missing key", async () => {
    const deleted = await fileStore.delete("no.such.key");
    expect(deleted).toBe(false);
  });

  test("persists to file on disk", async () => {
    await fileStore.store("persist.test", { ok: true });
    const filePath = fileStore.getFilePath();
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    expect(data["persist.test"].value).toEqual({ ok: true });
  });

  test("normalizes keys via normalizeMemoryKey", () => {
    expect(normalizeMemoryKey("  Design.Code  ")).toBe("design.code");
  });
});

describe("AgentMemoryService workspace scope dispatch", () => {
  let service;
  let tmpDir;

  beforeAll(async () => {
    const mod = await import("../../../dist/services/agent-memory.js");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-svc-test-"));
    service = new mod.AgentMemoryService(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("stores and retrieves via workspace scope", async () => {
    const scope = { scopeType: "workspace", scopeId: "default" };
    await service.store(scope, "project.constraint", { seismic_zone: 8 });
    const entry = await service.retrieve(scope, "project.constraint");
    expect(entry.value).toEqual({ seismic_zone: 8 });
    expect(entry.scopeType).toBe("workspace");
  });

  test("lists workspace entries", async () => {
    const scope = { scopeType: "workspace", scopeId: "default" };
    const entries = await service.list(scope);
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});
