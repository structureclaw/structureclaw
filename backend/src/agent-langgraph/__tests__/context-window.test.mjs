import { describe, expect, test } from "@jest/globals";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

describe("agent context window compaction", () => {
  test("leaves short message history unchanged", async () => {
    const { compactMessagesForContext } = await import("../../../dist/agent-langgraph/context-window.js");
    const messages = [
      new HumanMessage("hello"),
      new AIMessage("hi"),
    ];

    const result = compactMessagesForContext({
      messages,
      locale: "en",
      charLimit: 1000,
    });

    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  test("compacts older turns while preserving the current user turn", async () => {
    const { compactMessagesForContext } = await import("../../../dist/agent-langgraph/context-window.js");
    const messages = [
      new HumanMessage(`old request ${"x".repeat(900)}`),
      new AIMessage(`old answer ${"y".repeat(900)}`),
      new HumanMessage("current request"),
    ];

    const result = compactMessagesForContext({
      messages,
      locale: "en",
      charLimit: 1000,
      summaryCharLimit: 800,
    });

    expect(result.compacted).toBe(true);
    expect(result.compactedMessageCount).toBe(2);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]._getType()).toBe("ai");
    expect(String(result.messages[0].content)).toContain("automatically compacted");
    expect(String(result.messages[0].content)).toContain("quoted historical data");
    expect(result.messages[1].content).toBe("current request");
  });

  test("compacts tool output snippets without breaking the latest tool protocol messages", async () => {
    const { compactMessagesForContext } = await import("../../../dist/agent-langgraph/context-window.js");
    const messages = [
      new HumanMessage("search old files"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call-old", name: "grep_files", args: { query: "needle" } }],
      }),
      new ToolMessage({
        name: "grep_files",
        tool_call_id: "call-old",
        content: JSON.stringify({ matches: [{ preview: "x".repeat(1500) }] }),
      }),
      new AIMessage("old search completed"),
      new HumanMessage("current request"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call-current", name: "build_model", args: {} }],
      }),
      new ToolMessage({
        name: "build_model",
        tool_call_id: "call-current",
        content: JSON.stringify({ success: true }),
      }),
    ];

    const result = compactMessagesForContext({
      messages,
      locale: "en",
      charLimit: 1200,
      summaryCharLimit: 1000,
    });

    expect(result.compacted).toBe(true);
    expect(result.messages[0]._getType()).toBe("ai");
    expect(String(result.messages[0].content)).toContain("grep_files");
    expect(String(result.messages[0].content)).toContain("quoted historical data");
    expect(result.messages.slice(1).map((message) => message._getType())).toEqual(["human", "ai", "tool"]);
    expect(result.messages[2].content).toBe("");
    expect(result.messages[3].content).toBe(JSON.stringify({ success: true }));
  });
});
