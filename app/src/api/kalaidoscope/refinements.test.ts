import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  APPLY_RESULT_TOOL,
  extractPreviewFromMessages,
  extractPreviewReady,
  extractRefinePhase,
  extractSuggestedNameFromMessages,
  UPDATE_LENS_TOOL,
} from "./refinements";

/** A live-stream `dynamic-tool` part, as the AI SDK materializes tool calls. */
function liveTool(
  toolName: string,
  input: Record<string, unknown>,
  state: "input-streaming" | "input-available" = "input-available",
) {
  return { type: "dynamic-tool", toolName, state, input };
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

/** One full drafting turn: the lens call plus the server-fabricated apply. */
function draftingTurn(id: string, lens: string, output: string): UIMessage {
  return assistant(
    id,
    liveTool(UPDATE_LENS_TOOL, { lens }),
    liveTool(APPLY_RESULT_TOOL, { output }),
  );
}

describe("extractPreviewFromMessages", () => {
  it("is empty until an apply lands", () => {
    expect(
      extractPreviewFromMessages([
        user("u1", "make a digest"),
        assistant("a1", liveTool(UPDATE_LENS_TOOL, { lens: "THE LENS" })),
      ]),
    ).toBe("");
  });

  it("shows the newest apply output, live and persisted", () => {
    for (const make of [liveTool, persistedTool]) {
      const msgs = [
        assistant("a1", make(APPLY_RESULT_TOOL, { output: "# v1" })),
        assistant("a2", make(APPLY_RESULT_TOOL, { output: "# v2" })),
      ];
      expect(extractPreviewFromMessages(msgs)).toBe("# v2");
    }
  });

  it("includes a mid-stream partial so the preview renders live", () => {
    const msgs = [
      assistant(
        "a1",
        liveTool(
          APPLY_RESULT_TOOL,
          { output: "# partial…" },
          "input-streaming",
        ),
      ),
    ];
    expect(extractPreviewFromMessages(msgs)).toBe("# partial…");
  });

  it("keeps the prior preview across a clarify turn", () => {
    const msgs = [
      draftingTurn("a1", "LENS", "# v1"),
      user("u1", "cut the third bullet"),
      assistant("a2", { type: "text", text: "Do you mean the invoice part?" }),
    ];
    expect(extractPreviewFromMessages(msgs)).toBe("# v1");
  });

  it("never reads the lens as the preview", () => {
    const msgs = [
      assistant("a1", liveTool(UPDATE_LENS_TOOL, { lens: "SECRET LENS" })),
    ];
    expect(extractPreviewFromMessages(msgs)).toBe("");
  });
});

describe("extractPreviewReady", () => {
  it("is false with no apply, or only a streaming one", () => {
    expect(extractPreviewReady([])).toBe(false);
    expect(
      extractPreviewReady([
        assistant("a1", liveTool(UPDATE_LENS_TOOL, { lens: "L" })),
      ]),
    ).toBe(false);
    expect(
      extractPreviewReady([
        assistant(
          "a1",
          liveTool(APPLY_RESULT_TOOL, { output: "# part" }, "input-streaming"),
        ),
      ]),
    ).toBe(false);
  });

  it("is true once a terminal apply exists, live or persisted", () => {
    for (const make of [liveTool, persistedTool]) {
      expect(
        extractPreviewReady([
          assistant("a1", make(APPLY_RESULT_TOOL, { output: "# done" })),
        ]),
      ).toBe(true);
    }
  });

  it("survives a newer failed-apply turn (lens without apply part)", () => {
    const msgs = [
      draftingTurn("a1", "LENS V1", "# v1"),
      assistant("a2", liveTool(UPDATE_LENS_TOOL, { lens: "LENS V2" }), {
        type: "data-refine_error",
        data: { kind: "apply_failed" },
      }),
    ];
    // Still committable — the server pairs lens+output per message and will
    // refuse the un-previewed V2, but the standing preview from V1 remains.
    expect(extractPreviewReady(msgs)).toBe(true);
    expect(extractPreviewFromMessages(msgs)).toBe("# v1");
  });
});

describe("extractRefinePhase", () => {
  it("is idle with no assistant activity", () => {
    expect(extractRefinePhase([])).toBe("idle");
    expect(extractRefinePhase([user("u1", "hi")])).toBe("idle");
  });

  it("is drafting while the lens streams, and until the apply starts", () => {
    expect(
      extractRefinePhase([
        assistant(
          "a1",
          liveTool(UPDATE_LENS_TOOL, { lens: "L…" }, "input-streaming"),
        ),
      ]),
    ).toBe("drafting");
    expect(
      extractRefinePhase([
        assistant("a1", liveTool(UPDATE_LENS_TOOL, { lens: "L" })),
      ]),
    ).toBe("drafting");
  });

  it("is applying while the fabricated apply part streams", () => {
    expect(
      extractRefinePhase([
        assistant(
          "a1",
          liveTool(UPDATE_LENS_TOOL, { lens: "L" }),
          liveTool(APPLY_RESULT_TOOL, { output: "# p…" }, "input-streaming"),
        ),
      ]),
    ).toBe("applying");
  });

  it("is ready when the turn's apply is terminal", () => {
    expect(extractRefinePhase([draftingTurn("a1", "L", "# done")])).toBe(
      "ready",
    );
  });

  it("is idle after a clarify turn and after a failed apply", () => {
    expect(
      extractRefinePhase([
        draftingTurn("a1", "L", "# v1"),
        assistant("a2", { type: "text", text: "Do you mean X?" }),
      ]),
    ).toBe("idle");
    expect(
      extractRefinePhase([
        assistant("a1", liveTool(UPDATE_LENS_TOOL, { lens: "L" }), {
          type: "data-refine_error",
          data: { kind: "apply_failed" },
        }),
      ]),
    ).toBe("idle");
  });

  it("reflects only the newest assistant turn", () => {
    expect(
      extractRefinePhase([
        draftingTurn("a1", "L", "# v1"),
        assistant(
          "a2",
          liveTool(UPDATE_LENS_TOOL, { lens: "L2…" }, "input-streaming"),
        ),
      ]),
    ).toBe("drafting");
  });
});

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

  it("reads suggested_name riding an update_lens call, live and persisted", () => {
    for (const make of [liveTool, persistedTool]) {
      const msgs = [
        assistant(
          "a1",
          make(UPDATE_LENS_TOOL, {
            lens: "THE LENS",
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
        liveTool(UPDATE_LENS_TOOL, {
          lens: "L2",
          suggested_name: "Focused Digest",
        }),
      ),
    ];
    expect(extractSuggestedNameFromMessages(msgs)).toBe("Focused Digest");
  });

  it("keeps the older suggestion when a newer lens omits suggested_name", () => {
    const msgs = [
      assistant(
        "a1",
        liveTool(UPDATE_LENS_TOOL, { lens: "L1", suggested_name: "Digest" }),
      ),
      assistant("a2", liveTool(UPDATE_LENS_TOOL, { lens: "L2" })),
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

  it("does not disturb preview extraction", () => {
    const msgs = [
      assistant(
        "a1",
        liveTool(UPDATE_LENS_TOOL, { lens: "L", suggested_name: "Name" }),
        liveTool(APPLY_RESULT_TOOL, { output: "# Body" }),
      ),
    ];
    expect(extractPreviewFromMessages(msgs)).toBe("# Body");
  });
});
