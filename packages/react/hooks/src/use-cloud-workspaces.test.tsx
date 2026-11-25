import type { KalaidoscopeMeta } from "@kalaido/platform";
import { invalidateLiveTags } from "@kalaido/state/live";
import { act, renderHook, waitFor } from "@testing-library/react";
import { err, ok } from "neverthrow";
import type { ReactNode } from "react";
import { type Cache, SWRConfig } from "swr";
import { vi } from "vitest";
import {
  CLOUD_WORKSPACES_TAG,
  useCloudWorkspaces,
} from "#use-cloud-workspaces";

const {
  listCloudKalaidoscopes,
  getCloudSessionToken,
  getAuthClient,
  getCloudSessionAtom,
  mockSessionAtom,
} = vi.hoisted(() => {
  let state = {
    data: { user: { id: "u1", email: "a@b.co" } } as {
      user: { id: string; email: string };
    } | null,
    error: null,
    isPending: false,
    isRefetching: false,
  };
  const listeners = new Set<(v: typeof state) => void>();
  const mockSessionAtom = {
    get: () => state,
    set: (next: typeof state) => {
      state = next;
      for (const fn of listeners) fn(state);
    },
    subscribe: (fn: (v: typeof state) => void) => {
      fn(state);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    listCloudKalaidoscopes: vi.fn(),
    getCloudSessionToken: vi.fn(),
    getAuthClient: vi.fn(() => ({
      getSession: vi.fn(async () => ({ data: state.data, error: null })),
    })),
    getCloudSessionAtom: vi.fn(() => mockSessionAtom),
    mockSessionAtom,
  };
});

vi.mock("@kalaido/client/cloud/user", () => ({
  listCloudKalaidoscopes,
}));

vi.mock("@kalaido/client/cloud/auth", () => ({
  getCloudSessionToken,
  getAuthClient,
  getCloudSessionAtom,
}));

function makeWrapper() {
  const cache: Cache = new Map();
  return ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

const cloudMeta = (
  id: string,
  displayName: string,
  icon?: string,
): KalaidoscopeMeta => ({
  id,
  type: "cloud",
  locator: `https://s.kalaido.co/${id}`,
  displayName,
  ...(icon ? { icon } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionAtom.set({
    data: { user: { id: "u1", email: "a@b.co" } },
    error: null,
    isPending: false,
    isRefetching: false,
  });
  getCloudSessionToken.mockReturnValue(ok("tok_1"));
});

describe("useCloudWorkspaces", () => {
  test("hydrates cached workspaces offline, then reconciles and writes through offlineBridge when online", async () => {
    let cached: KalaidoscopeMeta[] = [cloudMeta("w1", "Old Name", "star")];
    const write = vi.fn((next: KalaidoscopeMeta[]) => {
      cached = next;
    });
    let online = false;

    listCloudKalaidoscopes.mockImplementation(async () =>
      online ? ok([cloudMeta("w1", "Fresh Name")]) : err(new Error("offline")),
    );

    const { result } = renderHook(
      () =>
        useCloudWorkspaces({
          offlineBridge: {
            read: () => cached,
            write,
          },
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([
        cloudMeta("w1", "Old Name", "star"),
      ]);
      expect(result.current.error?.message).toBe("offline");
    });
    expect(write).not.toHaveBeenCalled();

    online = true;
    await act(async () => {
      await invalidateLiveTags([CLOUD_WORKSPACES_TAG]);
    });

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([
        cloudMeta("w1", "Fresh Name", "star"),
      ]);
      expect(result.current.error).toBeNull();
    });
    expect(write).toHaveBeenCalledWith([cloudMeta("w1", "Fresh Name", "star")]);
  });

  test("skips offlineBridge.write when session token was dropped mid-flight", async () => {
    const write = vi.fn();
    getCloudSessionToken.mockReturnValue(err(new Error("Not signed in")));
    listCloudKalaidoscopes.mockResolvedValue(ok([cloudMeta("w1", "Fresh")]));

    const { result } = renderHook(
      () =>
        useCloudWorkspaces({
          offlineBridge: {
            read: () => [],
            write,
          },
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([cloudMeta("w1", "Fresh")]);
    });
    expect(write).not.toHaveBeenCalled();
  });

  test("swallows disposed-scope errors during offlineBridge.write", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.fn(async () => {
      throw new Error("Cannot dispatch on a disposed scope.");
    });
    listCloudKalaidoscopes.mockResolvedValue(ok([cloudMeta("w1", "Fresh")]));

    const { result } = renderHook(
      () =>
        useCloudWorkspaces({
          offlineBridge: {
            read: () => [],
            write,
          },
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([cloudMeta("w1", "Fresh")]);
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test("does not fetch when signed out", () => {
    mockSessionAtom.set({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
    });

    const { result } = renderHook(() => useCloudWorkspaces(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.workspaces).toEqual([]);
    expect(listCloudKalaidoscopes).not.toHaveBeenCalled();
  });
});
