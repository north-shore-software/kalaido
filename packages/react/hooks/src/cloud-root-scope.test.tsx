import { getCloudSessionToken } from "@kalaido/client/cloud/auth";
import {
  CloudAuthRequiredError,
  createCloudClient,
} from "@kalaido/client/kalaidoscope/client";
import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import type {
  KalaidoscopeMeta,
  PersistentAppSetting,
  SettingsStore,
} from "@kalaido/platform";
import { ok } from "neverthrow";
import { vi } from "vitest";
import {
  createCloudRootScope,
  openCloudWorkspaceForScope,
  pathForCloudStage,
  prepareCloudScopeReset,
  showCloudWorkspacePickerForScope,
  wireCloudScopeTokenBridge,
} from "#cloud-root-scope";

vi.mock("@kalaido/client/kalaidoscope/client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@kalaido/client/kalaidoscope/client")
    >();
  return {
    ...actual,
    createCloudClient: vi.fn(),
  };
});

function createMemorySettings(
  seed: Partial<PersistentAppSetting> = {},
): SettingsStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...seed };
  return {
    data,
    get: async (k) => ok(data[k] as PersistentAppSetting[typeof k] | undefined),
    getAll: async () => ok({ ...data } as Partial<PersistentAppSetting>),
    set: async (k, v) => {
      data[k] = v;
      return ok(undefined);
    },
    delete: async (k) => {
      delete data[k];
      return ok(undefined);
    },
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
      return ok(undefined);
    },
  };
}

const cloudMeta = (id: string, archivedAt?: string): KalaidoscopeMeta => ({
  id,
  type: "cloud",
  locator: id,
  displayName: `Workspace ${id}`,
  ...(archivedAt ? { archivedAt } : {}),
});

describe("createCloudRootScope", () => {
  test("hydrates persisted keys and derives workspace_load_requested when lastOpened is active", async () => {
    const store = createMemorySettings({
      theme: "dark",
      cloudSessionToken: "tok_abc",
      lastOpenedKalaidoscopeId: "w1",
      cachedCloudKalaidoscopes: [cloudMeta("w1")],
    });
    const scope = createCloudRootScope(store);
    const detach = wireCloudScopeTokenBridge(scope);

    const res = await scope.hydrate();
    expect(res.isOk()).toBe(true);
    expect(scope.state.theme).toBe("dark");
    expect(scope.state.stage).toEqual({
      stage: "workspace_load_requested",
      workspaceId: "w1",
    });
    expect(getCloudSessionToken()._unsafeUnwrap()).toBe("tok_abc");

    await scope.dispatch({ type: "setTheme", theme: "light" });
    await scope.flush();
    expect(store.data.theme).toBe("light");

    await prepareCloudScopeReset(scope, detach);
    expect(getCloudSessionToken().isErr()).toBe(true);
    await expect(
      scope.dispatch({ type: "setTheme", theme: "dark" }),
    ).rejects.toThrow(/disposed/i);
  });

  test("falls back to signed_out when lastOpened is archived or absent", async () => {
    const store = createMemorySettings({
      lastOpenedKalaidoscopeId: "w1",
      cachedCloudKalaidoscopes: [cloudMeta("w1", "2026-01-01T00:00:00Z")],
    });
    const scope = createCloudRootScope(store);

    await scope.hydrate();
    expect(scope.state.stage).toEqual({ stage: "signed_out" });

    scope.dispose();
  });

  test("signOut clears token, cached workspaces, and lastOpened in store on flush", async () => {
    const store = createMemorySettings({
      cloudSessionToken: "tok_1",
      lastOpenedKalaidoscopeId: "w1",
      cachedCloudKalaidoscopes: [cloudMeta("w1")],
    });
    const scope = createCloudRootScope(store);
    await scope.hydrate();

    await scope.dispatch({ type: "signOut" });
    await scope.flush();

    expect(scope.state.cloudSessionToken).toBeUndefined();
    expect(scope.state.cachedCloudKalaidoscopes).toEqual([]);
    expect(scope.state.stage).toEqual({ stage: "signed_out" });
    expect(store.data.cloudSessionToken).toBeUndefined();
    expect(store.data.lastOpenedKalaidoscopeId).toBeUndefined();
    expect(store.data.cachedCloudKalaidoscopes).toEqual([]);

    scope.dispose();
  });

  test("openCloudWorkspaceForScope transitions through workspace_loading to workspace_open", async () => {
    const store = createMemorySettings({
      cloudSessionToken: "tok_1",
      cachedCloudKalaidoscopes: [cloudMeta("w1")],
    });
    const scope = createCloudRootScope(store);
    await scope.hydrate();

    let stageWhileCreatingClient: unknown;
    vi.mocked(createCloudClient).mockImplementationOnce(async () => {
      stageWhileCreatingClient = scope.state.stage;
      return {
        baseURL: "https://s.kalaido.co/w1",
        cancelAllRequests: vi.fn(),
      } as unknown as TypedPocketBase;
    });

    const res = await openCloudWorkspaceForScope(scope, "w1");
    expect(res.isOk()).toBe(true);
    expect(stageWhileCreatingClient).toEqual({
      stage: "workspace_loading",
      workspaceId: "w1",
    });
    expect(scope.state.stage).toEqual({
      stage: "workspace_open",
      workspaceId: "w1",
    });
    expect(pathForCloudStage(scope.state.stage)).toBe("/explore");

    scope.dispose();
  });

  test("openCloudWorkspaceForScope transitions to workspace_load_error on container failure and routes to /boot-error", async () => {
    const store = createMemorySettings({
      cloudSessionToken: "tok_1",
      cachedCloudKalaidoscopes: [cloudMeta("w1")],
    });
    const scope = createCloudRootScope(store);
    await scope.hydrate();

    vi.mocked(createCloudClient).mockRejectedValueOnce(
      new Error("Container failed to start"),
    );

    const res = await openCloudWorkspaceForScope(scope, "w1");
    expect(res.isErr()).toBe(true);
    expect(scope.state.stage).toEqual({
      stage: "workspace_load_error",
      workspaceId: "w1",
      error: expect.objectContaining({ message: "Container failed to start" }),
    });
    expect(pathForCloudStage(scope.state.stage)).toBe("/boot-error");

    await showCloudWorkspacePickerForScope(scope);
    expect(scope.state.stage).toEqual({ stage: "workspace_picker" });
    expect(pathForCloudStage(scope.state.stage)).toBe("/workspaces");

    scope.dispose();
  });

  test("openCloudWorkspaceForScope transitions to signed_out on CloudAuthRequiredError and routes to /login", async () => {
    const store = createMemorySettings({
      cloudSessionToken: "expired_tok",
      cachedCloudKalaidoscopes: [cloudMeta("w1")],
    });
    const scope = createCloudRootScope(store);
    await scope.hydrate();

    vi.mocked(createCloudClient).mockRejectedValueOnce(
      new CloudAuthRequiredError(
        "Cloud session expired. Please sign in again.",
      ),
    );

    const res = await openCloudWorkspaceForScope(scope, "w1");
    expect(res.isErr()).toBe(true);
    expect(scope.state.stage).toEqual({ stage: "signed_out" });
    expect(pathForCloudStage(scope.state.stage)).toBe("/login");

    scope.dispose();
  });
});
