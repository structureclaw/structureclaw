import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("workspace tools", () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sclaw-workspace-tools-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "agent.ts"), "export const marker = 'needle';\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test("safeResolve blocks traversal", async () => {
    const { safeResolve } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    expect(() => safeResolve(root, "../outside.txt")).toThrow(/Path traversal blocked/);
  });

  test("grep_files returns content matches", async () => {
    const { createGrepFilesTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createGrepFilesTool();
    const raw = await tool.invoke(
      { query: "needle", pattern: "**/*.ts" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].path).toBe("src/agent.ts");
  });

  test("glob_files returns paginated matches without reading file contents", async () => {
    await fs.writeFile(path.join(root, "src", "beam.ts"), "export const beam = true;\n", "utf8");
    await fs.writeFile(path.join(root, "src", "frame.ts"), "export const frame = true;\n", "utf8");
    const { createGlobFilesTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createGlobFilesTool();

    const firstRaw = await tool.invoke(
      { pattern: "src/*.ts", maxResults: 1 },
      { configurable: { workspaceRoot: root } },
    );
    const first = JSON.parse(firstRaw);

    expect(first.totalMatches).toBe(3);
    expect(first.shownCount).toBe(1);
    expect(first.nextOffset).toBe(1);
    expect(first.files).toEqual(["src/agent.ts"]);
    expect(first.truncated).toBe(false);

    const secondRaw = await tool.invoke(
      { pattern: "src/*.ts", maxResults: 2, offset: first.nextOffset },
      { configurable: { workspaceRoot: root } },
    );
    const second = JSON.parse(secondRaw);

    expect(second.files).toEqual(["src/beam.ts", "src/frame.ts"]);
    expect(second.nextOffset).toBeNull();
  });

  test("grep_files skips unsupported files instead of failing the search", async () => {
    await fs.writeFile(path.join(root, "LICENSE"), "needle in a no-extension file\n", "utf8");
    const { createGrepFilesTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createGrepFilesTool();
    const raw = await tool.invoke(
      { query: "needle" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.totalMatches).toBe(1);
    expect(result.skippedFiles).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].path).toBe("src/agent.ts");
  });

  test("grep_files skips binary-looking allowed files instead of returning garbled matches", async () => {
    await fs.writeFile(path.join(root, "src", "binary.ts"), Buffer.from([0, 1, 2, 110, 101, 101, 100, 108, 101]));
    const { createGrepFilesTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createGrepFilesTool();
    const raw = await tool.invoke(
      { query: "needle", pattern: "**/*.ts" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);

    expect(result.totalMatches).toBe(1);
    expect(result.skippedFiles).toBeGreaterThanOrEqual(1);
    expect(result.matches).toEqual([
      expect.objectContaining({ path: "src/agent.ts" }),
    ]);
  });

  test("glob_files and grep_files skip symlink entries when supported", async () => {
    const outside = path.join(os.tmpdir(), `sclaw-outside-${Date.now()}.ts`);
    await fs.writeFile(outside, "export const leaked = 'needle';\n", "utf8");
    try {
      await fs.symlink(outside, path.join(root, "src", "outside.ts"), "file");
    } catch (error) {
      await fs.rm(outside, { force: true });
      if (error && ["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        expect(true).toBe(true);
        return;
      }
      throw error;
    }

    try {
      const { createGlobFilesTool, createGrepFilesTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
      const globTool = createGlobFilesTool();
      const grepTool = createGrepFilesTool();

      const globRaw = await globTool.invoke(
        { pattern: "**/*.ts" },
        { configurable: { workspaceRoot: root } },
      );
      const globResult = JSON.parse(globRaw);
      expect(globResult.files).not.toContain("src/outside.ts");
      expect(globResult.skippedEntries).toBeGreaterThanOrEqual(1);

      const grepRaw = await grepTool.invoke(
        { query: "needle", pattern: "**/*.ts" },
        { configurable: { workspaceRoot: root } },
      );
      const grepResult = JSON.parse(grepRaw);
      expect(grepResult.totalMatches).toBe(1);
      expect(grepResult.matches[0].path).toBe("src/agent.ts");
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  test("grep_files stops scanning files after the match cap is reached", async () => {
    await fs.writeFile(
      path.join(root, "src", "000-cap.ts"),
      `${Array.from({ length: 1000 }, () => "needle").join("\n")}\n`,
      "utf8",
    );
    await fs.writeFile(path.join(root, "src", "zzz-unsupported.bin"), "needle\n", "utf8");
    const { createGrepFilesTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createGrepFilesTool();
    const raw = await tool.invoke(
      { query: "needle" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.totalMatches).toBe(1000);
    expect(result.skippedFiles).toBe(0);
  });

  test("replace_in_file requires exact text", async () => {
    const { createReplaceInFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createReplaceInFileTool();
    const raw = await tool.invoke(
      { filePath: "src/agent.ts", oldText: "needle", newText: "updated", expectedReplacements: 1 },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    const content = await fs.readFile(path.join(root, "src", "agent.ts"), "utf8");
    expect(result.success).toBe(true);
    expect(content).toContain("updated");
  });

  // ── read_file ──────────────────────────────────────────────────────────────

  test("read_file reads a text file", async () => {
    const { createReadFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createReadFileTool();
    const raw = await tool.invoke(
      { filePath: "src/agent.ts" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.type).toBe("text");
    expect(result.content).toContain("needle");
  });

  test("read_file detects binary content", async () => {
    await fs.writeFile(path.join(root, "src", "data.bin"), Buffer.from([0, 1, 2, 3]));
    const { createReadFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createReadFileTool();
    const raw = await tool.invoke(
      { filePath: "src/data.bin" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.type).toBe("binary");
  });

  test("read_file omits image base64 from tool output", async () => {
    await fs.writeFile(
      path.join(root, "src", "sketch.png"),
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ6pYQAAAABJRU5ErkJggg==", "base64"),
    );
    const { createReadFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createReadFileTool();
    const raw = await tool.invoke(
      { filePath: "src/sketch.png" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.type).toBe("image");
    expect(result.mimeType).toBe("image/png");
    expect(result.base64DataUri).toBeUndefined();
  });

  test("read_file blocks traversal", async () => {
    const { createReadFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createReadFileTool();
    const raw = await tool.invoke(
      { filePath: "../outside.txt" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
  });

  test("read_file returns FILE_NOT_FOUND for missing file", async () => {
    const { createReadFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createReadFileTool();
    const raw = await tool.invoke(
      { filePath: "src/missing.ts" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toBe("FILE_NOT_FOUND");
  });

  // ── write_file ─────────────────────────────────────────────────────────────

  test("write_file creates new file with parent dirs", async () => {
    const { createWriteFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createWriteFileTool();
    const raw = await tool.invoke(
      { filePath: "src/deep/new-file.ts", content: "export const x = 1;\n" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(root, "src", "deep", "new-file.ts"), "utf8");
    expect(content).toBe("export const x = 1;\n");
  });

  test("write_file blocks traversal", async () => {
    const { createWriteFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createWriteFileTool();
    await expect(
      tool.invoke(
        { filePath: "../outside.ts", content: "evil" },
        { configurable: { workspaceRoot: root } },
      ),
    ).rejects.toThrow(/Path traversal/);
  });

  test("write_file rejects disallowed extension", async () => {
    const { createWriteFileTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createWriteFileTool();
    await expect(
      tool.invoke(
        { filePath: "evil.exe", content: "binary" },
        { configurable: { workspaceRoot: root } },
      ),
    ).rejects.toThrow(/denied/);
  });

  // ── move_path ──────────────────────────────────────────────────────────────

  test("move_path renames a file", async () => {
    const { createMovePathTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createMovePathTool();
    const raw = await tool.invoke(
      { fromPath: "src/agent.ts", toPath: "src/renamed.ts" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(root, "src", "renamed.ts"), "utf8");
    expect(content).toContain("needle");
  });

  test("move_path blocks traversal", async () => {
    const { createMovePathTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createMovePathTool();
    await expect(
      tool.invoke(
        { fromPath: "src/agent.ts", toPath: "../outside.ts" },
        { configurable: { workspaceRoot: root } },
      ),
    ).rejects.toThrow(/Path traversal/);
  });

  // ── delete_path ────────────────────────────────────────────────────────────

  test("delete_path removes a file", async () => {
    await fs.writeFile(path.join(root, "src", "to-delete.ts"), "temp", "utf8");
    const { createDeletePathTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createDeletePathTool();
    const raw = await tool.invoke(
      { filePath: "src/to-delete.ts" },
      { configurable: { workspaceRoot: root } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    await expect(fs.stat(path.join(root, "src", "to-delete.ts"))).rejects.toThrow();
  });

  test("delete_path blocks traversal", async () => {
    const { createDeletePathTool } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    const tool = createDeletePathTool();
    await expect(
      tool.invoke(
        { filePath: "../outside.ts" },
        { configurable: { workspaceRoot: root } },
      ),
    ).rejects.toThrow(/Path traversal/);
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  test("isProbablyBinary returns true for buffer with null byte", async () => {
    const { isProbablyBinary } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    expect(isProbablyBinary(Buffer.from([0, 1, 2]))).toBe(true);
  });

  test("isProbablyBinary returns false for text buffer", async () => {
    const { isProbablyBinary } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    expect(isProbablyBinary(Buffer.from("hello world"))).toBe(false);
  });

  test("isAllowedFile accepts .ts extension", async () => {
    const { isAllowedFile } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    expect(isAllowedFile("test.ts")).toBe(true);
  });

  test("isAllowedFile rejects .exe extension", async () => {
    const { isAllowedFile } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    expect(isAllowedFile("program.exe")).toBe(false);
  });

  test("isAllowedFile rejects no extension", async () => {
    const { isAllowedFile } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    expect(isAllowedFile("Makefile")).toBe(false);
  });

  test("assertAllowedFile throws for denied extension", async () => {
    const { assertAllowedFile } = await import("../../../dist/agent-langgraph/workspace-tools.js");
    expect(() => assertAllowedFile("evil.exe")).toThrow(/denied/);
  });
});
