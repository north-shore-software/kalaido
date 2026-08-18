import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  extractDraftFromMessages,
  extractSuggestedNameFromMessages,
} from "./refinements";

/** A live-stream `dynamic-tool` part, as the AI SDK materializes tool calls. */
function liveTool(toolName: string, input: Record<string, unknown>) {
  return { type: "dynamic-tool", toolName, state: "input-available", input };
}

/** A persisted part, as the backend stores tool turns (`tool-<name>` + data). */
function persistedTool(toolName: string, input: Record<string, unknown>) {
  return {
    type: `tool-${toolName}`,
    data: { toolCallId: "tc1", toolName, input },
  };
}

function assistant(id: string, ...parts: unknown[]): UIMessage {
  return { id, role: "assistant", parts } as unknown as UIMessage;
}

function user(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

describe("extractSuggestedNameFromMessages", () => {
  it("returns empty when no suggestion has landed", () => {
    expect(
      extractSuggestedNameFromMessages([
        user("u1", "hello"),
        assistant("a1", { type: "text", text: "What kind of doc?" }),
      ]),
    ).toBe("");
  });

  it("reads a live suggest_name call", () => {
    const msgs = [
      user("u1", "make a digest"),
      assistant("a1", liveTool("suggest_name", { name: "Weekly Digest" })),
    ];
    expect(extractSuggestedNameFromMessages(msgs)).toBe("Weekly Digest");
  });

  it("reads a persisted suggest_name part", () => {
    const msgs = [
      assistant("a1", persistedTool("suggest_name", { name: "Weekly Digest" })),
    ];
    expect(extractSuggestedNameFromMessages(msgs)).toBe("Weekly Digest");
  });

  it("reads suggested_name riding an update_draft call, live and persisted", () => {
    for (const make of [liveTool, persistedTool]) {
      const msgs = [
        assistant(
          "a1",
          make("update_draft", {
            draft: "# Digest",
            suggested_name: "Team Digest",
          }),
        ),
      ];
      expect(extractSuggestedNameFromMessages(msgs)).toBe("Team Digest");
    }
  });

  it("prefers the newest suggestion across carriers", () => {
    const msgs = [
      assistant("a1", liveTool("suggest_name", { name: "First Guess" })),
      user("u1", "more focused please"),
      assistant(
        "a2",
        liveTool("update_draft", {
          draft: "# v2",
          suggested_name: "Focused Digest",
        }),
      ),
    ];
    expect(extractSuggestedNameFromMessages(msgs)).toBe("Focused Digest");
  });

  it("keeps the older suggestion when a newer draft omits suggested_name", () => {
    const msgs = [
      assistant(
        "a1",
        liveTool("update_draft", { draft: "# v1", suggested_name: "Digest" }),
      ),
      assistant("a2", liveTool("update_draft", { draft: "# v2" })),
    ];
    expect(extractSuggestedNameFromMessages(msgs)).toBe("Digest");
  });

  it("ignores whitespace-only suggestions and trims real ones", () => {
    const msgs = [
      assistant("a1", liveTool("suggest_name", { name: "  Digest  " })),
      assistant("a2", liveTool("suggest_name", { name: "   " })),
    ];
    expect(extractSuggestedNameFromMessages(msgs)).toBe("Digest");
  });

  it("does not disturb draft extraction", () => {
    const msgs = [
      assistant(
        "a1",
        liveTool("update_draft", { draft: "# Body", suggested_name: "Name" }),
      ),
    ];
    expect(extractDraftFromMessages(msgs)).toBe("# Body");
  });
});
