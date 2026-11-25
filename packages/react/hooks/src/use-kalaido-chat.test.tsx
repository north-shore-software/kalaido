import type { ContextItem } from "@kalaido/client/kalaidoscope/chat";
import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useKalaidoChat } from "#use-kalaido-chat";
import { KalaidoscopeClientContext } from "#use-kalaidoscope-client";

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
  },
}));

vi.mock("@kalaido/client/kalaidoscope/client", () => ({
  kalaidoscopeAuthHeaders: vi.fn().mockResolvedValue({}),
}));

const mockClient = {
  baseURL: "http://127.0.0.1:8090",
} as unknown as TypedPocketBase;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <KalaidoscopeClientContext value={mockClient}>
      {children}
    </KalaidoscopeClientContext>
  );
}

describe("useKalaidoChat", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("fails closed without hitting /api/explore when api is undefined", async () => {
    const { result } = renderHook(
      () => useKalaidoChat({ chatId: "idle-chat", api: undefined }),
      { wrapper },
    );

    act(() => {
      result.current.sendUserMessage("hello");
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Chat failed", {
        description: "Chat endpoint is not configured",
      });
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("recreates chat transport when api transitions from undefined to a path for the same chatId", async () => {
    const { result, rerender } = renderHook(
      ({ api }: { api?: string }) => useKalaidoChat({ chatId: "same-id", api }),
      { wrapper, initialProps: { api: undefined as string | undefined } },
    );

    rerender({ api: "/api/projections/p1/refinements/r1/chat" });

    act(() => {
      result.current.sendUserMessage("draft this");
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8090/api/projections/p1/refinements/r1/chat",
    );
  });

  test("openAndSend without api or context falls back to the hook's current options and survives rerender", async () => {
    const context: ContextItem[] = [
      { kind: "Fragment", id: "f1", label: "Note 1" },
    ];
    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string }) =>
        useKalaidoChat({ chatId, api: "/api/explore", context }),
      { wrapper, initialProps: { chatId: "chat-1" } },
    );

    act(() => {
      result.current.openAndSend({ chatId: "chat-2", prompt: "hello explore" });
      rerender({ chatId: "chat-2" });
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8090/api/explore",
    );
    const firstInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const firstPayload = JSON.parse(String(firstInit?.body ?? "{}")) as {
      messages?: { role: string; parts?: { type: string }[] }[];
    };
    expect(
      firstPayload.messages?.some(
        (m) =>
          m.role === "system" &&
          m.parts?.some((p) => p.type === "context_spec"),
      ),
    ).toBe(true);
    expect(toastError).not.toHaveBeenCalled();

    // A subsequent rerender with the same chatId/api must keep the opened chat.
    rerender({ chatId: "chat-2" });
    expect(result.current.messages.some((m) => m.role === "user")).toBe(true);
  });

  test("resets context baseline when only api changes for the same chatId", async () => {
    const context: ContextItem[] = [
      { kind: "Fragment", id: "f1", label: "Note 1" },
    ];
    const { result, rerender } = renderHook(
      ({ api }: { api: string }) =>
        useKalaidoChat({ chatId: "same-id", api, context }),
      { wrapper, initialProps: { api: "/api/explore" } },
    );

    act(() => {
      result.current.sendUserMessage("first turn");
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Switch endpoint without changing chatId -> chat rebuilds from empty
    // initialMessages, so context_spec must be emitted again on the next send.
    rerender({ api: "/api/projections/p1/refinements/r1/chat" });

    act(() => {
      result.current.sendUserMessage("second turn on new endpoint");
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    const secondInit = fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(secondInit?.body ?? "{}")) as {
      messages?: { role: string; parts?: { type: string }[] }[];
    };
    const hasContextSpec = payload.messages?.some(
      (m) =>
        m.role === "system" && m.parts?.some((p) => p.type === "context_spec"),
    );
    expect(hasContextSpec).toBe(true);
  });
});
