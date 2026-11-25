import type { PersistentAppSetting, SettingsStore } from "@kalaido/platform";
import { ok } from "neverthrow";
import { hostSettingsPersistence } from "#scope-persistence";

describe("hostSettingsPersistence", () => {
  test("bridges HostAdapter SettingsStore to ScopePersistenceAdapter for selected keys only", async () => {
    const backing: Partial<PersistentAppSetting> = {
      ollamaModel: "gemma4",
      onboardingAcknowledged: true,
      lastOpenedKalaidoscopeId: "ws-99",
    };

    const settingsStore: SettingsStore = {
      get: async (k) => ok(backing[k]),
      getAll: async () => ok({ ...backing }),
      set: async (k, v) => {
        (backing as Record<string, unknown>)[k] = v;
        return ok(undefined);
      },
      delete: async (k) => {
        delete backing[k];
        return ok(undefined);
      },
      clear: async () => {
        for (const k of Object.keys(backing)) {
          delete (backing as Record<string, unknown>)[k];
        }
        return ok(undefined);
      },
    };

    const adapter = hostSettingsPersistence(
      ["ollamaModel", "lastOpenedKalaidoscopeId"] as const,
      settingsStore,
    );

    const loaded = await adapter.load();
    expect(loaded.isOk()).toBe(true);
    if (loaded.isOk()) {
      expect(loaded.value).toEqual({
        ollamaModel: "gemma4",
        lastOpenedKalaidoscopeId: "ws-99",
      });
      expect("onboardingAcknowledged" in loaded.value).toBe(false);
    }

    await adapter.save("ollamaModel", "llama3");
    expect(backing.ollamaModel).toBe("llama3");

    await adapter.remove("lastOpenedKalaidoscopeId");
    expect("lastOpenedKalaidoscopeId" in backing).toBe(false);
  });
});
