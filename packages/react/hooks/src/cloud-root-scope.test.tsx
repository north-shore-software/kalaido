import { getCloudSessionToken } from "@kalaido/client/cloud/auth";
import type {
  KalaidoscopeMeta,
  PersistentAppSetting,
  SettingsStore,
} from "@kalaido/platform";
import { ok } from "neverthrow";
import {
  createCloudRootScope,
  prepareCloudScopeReset,
  wireCloudScopeTokenBridge,
} from "#cloud-root-scope";

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
  locator: `https://s.kalaido.co/${id}`,
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
});
