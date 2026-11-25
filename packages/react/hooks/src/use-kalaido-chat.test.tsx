import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { KalaidoscopeClientContext } from "#use-kalaidoscope-client";
import { useKalaidoChat } from "#use-kalaido-chat";

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
});
