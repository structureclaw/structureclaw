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
});
