import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeHtml } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkOllamaStatus } from "@/api/app/ollama-status";
import {
  openFilePicker,
  registerMenuNavigateListener,
  saveFilePicker,
} from "@/api/app/os-integrations";
import { checkForUpdate, installPendingUpdate } from "@/api/app/updater";
import { createAppHost } from "@/host";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeHtml: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe("non-Tauri fallback (isTauri() === false)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  test("createTauriHost drops calls and notifies via onUnsupportedAction without calling Tauri plugins", async () => {
    const host = createAppHost();

    // Hydrate reads return empty without notification so boot succeeds quietly
    const all = await host.settings.getAll();
    expect(all.isOk()).toBe(true);
    expect(all._unsafeUnwrap()).toEqual({});
    expect(load).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();

    const setRes = await host.settings.set("theme", "dark");
    expect(setRes.isOk()).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "settings.set(theme)" }),
    );

    vi.mocked(toast.info).mockClear();
    const clipRes = await host.clipboard.writeHtml("<b>hi</b>", "hi");
    expect(clipRes.isOk()).toBe(true);
    expect(writeHtml).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "clipboard.writeHtml" }),
    );

    vi.mocked(toast.info).mockClear();
    const urlRes = await host.openExternalUrl("https://example.com");
    expect(urlRes.isOk()).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "openExternalUrl" }),
    );

    vi.mocked(toast.info).mockClear();
    host.reload();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "reload" }),
    );
  });

  test("desktop Tauri API wrappers no-op and notify when running outside Tauri", async () => {
    const pickRes = await openFilePicker();
    expect(pickRes.isOk()).toBe(true);
    expect(pickRes._unsafeUnwrap()).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "dialog.open" }),
    );

    vi.mocked(toast.info).mockClear();
    const saveRes = await saveFilePicker("backup.zip");
    expect(saveRes.isOk()).toBe(true);
    expect(saveRes._unsafeUnwrap()).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "dialog.save" }),
    );

    vi.mocked(toast.info).mockClear();
    const ollamaRes = await checkOllamaStatus();
    expect(ollamaRes.isOk()).toBe(true);
    expect(ollamaRes._unsafeUnwrap()).toEqual({ reachable: false });
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "check_ollama_status" }),
    );

    vi.mocked(toast.info).mockClear();
    const updateRes = await checkForUpdate();
    expect(updateRes.isOk()).toBe(true);
    expect(updateRes._unsafeUnwrap()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "check_for_update" }),
    );

    vi.mocked(toast.info).mockClear();
    const installRes = await installPendingUpdate();
    expect(installRes.isOk()).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({ description: "install_pending_update" }),
    );
  });

  test("background event listeners silently return a no-op unlisten outside Tauri", async () => {
    const listenRes = await registerMenuNavigateListener(() => {});
    expect(listenRes.isOk()).toBe(true);
    expect(typeof listenRes._unsafeUnwrap()).toBe("function");
    expect(listen).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
