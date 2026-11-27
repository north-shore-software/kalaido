import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeHtml } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load } from "@tauri-apps/plugin-store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createDebouncedActionReporter,
  type UnsupportedActionBatch,
} from "#index";
import { createTauriHost } from "#tauri";
import { createDesktopTauriHost } from "./tauri-desktop";

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

describe("createDebouncedActionReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("coalesces bursts into a single batch with count and resets on close", () => {
    const batches: UnsupportedActionBatch[] = [];
    const reporter = createDebouncedActionReporter((b) => batches.push(b), 100);

    reporter.report("settings.getAll");
    reporter.report("listen(menu:navigate)");
    reporter.report("listen(menu:feedback)");
    reporter.report("listen(menu:check-updates)");
    reporter.report("listen(menu:navigate)");

    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      count: 5,
      title: "Not supported outside Tauri (5)",
      description:
        "settings.getAll, listen(menu:navigate), listen(menu:feedback), +1 more",
    });

    // Follow-up action while toast is still open increments the same count
    reporter.report("dialog.open");
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toMatchObject({
      count: 6,
      title: "Not supported outside Tauri (6)",
    });

    // Closing the toast resets displayed count without dropping newly queued work
    reporter.report("clipboard.writeHtml");
    batches[1]?.onClose();
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(3);
    expect(batches[2]).toMatchObject({
      count: 1,
      title: "Not supported outside Tauri",
      description: "clipboard.writeHtml",
    });
  });
});

describe("createTauriHost and createDesktopTauriHost", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  test("createTauriHost outside Tauri reports reads/writes and calls window.location.reload()", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    const reported: string[] = [];
    const host = createTauriHost({
      variant: "mobile",
      onUnsupportedAction: (action) => reported.push(action),
    });

    const getRes = await host.settings.get("theme");
    expect(getRes._unsafeUnwrap()).toBeUndefined();

    const allRes = await host.settings.getAll();
    expect(allRes._unsafeUnwrap()).toEqual({});

    await host.settings.set("theme", "dark");
    await host.clipboard.writeHtml("<b>hi</b>", "hi");
    await host.openExternalUrl("https://example.com");

    expect(load).not.toHaveBeenCalled();
    expect(writeHtml).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(reported).toEqual([
      "settings.get(theme)",
      "settings.getAll",
      "settings.set(theme)",
      "clipboard.writeHtml",
      "openExternalUrl",
    ]);

    host.reload();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reported).not.toContain("reload");
  });

  test("createDesktopTauriHost outside Tauri drops sub-adapter calls including listen and returns unsupported update status", async () => {
    const reported: string[] = [];
    const host = createDesktopTauriHost({
      onUnsupportedAction: (action) => reported.push(action),
    });

    const pickRes = await host.dialogs.openFile();
    expect(pickRes._unsafeUnwrap()).toBeNull();
    expect(open).not.toHaveBeenCalled();

    const saveRes = await host.dialogs.saveFile("backup.zip");
    expect(saveRes._unsafeUnwrap()).toBeNull();
    expect(save).not.toHaveBeenCalled();

    const navRes = await host.menu.onNavigate(() => {});
    expect(typeof navRes._unsafeUnwrap()).toBe("function");
    expect(listen).not.toHaveBeenCalled();

    const sidecarListenRes = await host.sidecar.onStatusChange(() => {});
    expect(typeof sidecarListenRes._unsafeUnwrap()).toBe("function");

    const ollamaRes = await host.llm.checkOllamaStatus();
    expect(ollamaRes._unsafeUnwrap()).toEqual({ reachable: false });

    const updateRes = await host.updater.check();
    expect(updateRes._unsafeUnwrap()).toEqual({ status: "unsupported" });

    await host.updater.install();
    expect(invoke).not.toHaveBeenCalled();

    expect(reported).toEqual([
      "dialog.open",
      "dialog.save",
      "listen(menu:navigate)",
      "listen(sidecar:pocketbase:status)",
      "check_ollama_status",
      "check_for_update",
      "install_pending_update",
    ]);
  });

  test("createDesktopTauriHost inside Tauri maps check_for_update to available vs up_to_date", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const host = createDesktopTauriHost();

    vi.mocked(invoke).mockResolvedValueOnce(null);
    const upToDate = await host.updater.check();
    expect(upToDate._unsafeUnwrap()).toEqual({ status: "up_to_date" });

    const meta = {
      version: "0.1.0",
      currentVersion: "0.0.23",
      body: "notes",
      date: null,
    };
    vi.mocked(invoke).mockResolvedValueOnce(meta);
    const available = await host.updater.check();
    expect(available._unsafeUnwrap()).toEqual({
      status: "available",
      update: meta,
    });
  });
});
