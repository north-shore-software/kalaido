import { setHost } from "@kalaido/platform";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { checkOllamaStatus } from "@/api/app/ollama-status";
import {
  openFilePicker,
  registerMenuNavigateListener,
} from "@/api/app/os-integrations";
import { createAppHost } from "@/host";
import { checkForUpdatesAndPrompt } from "@/lib/app-updates";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe("desktop non-Tauri host wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setHost(createAppHost());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("coalesces multiple unsupported calls (including settings reads and listen) into one debounced toast", async () => {
    const host = createAppHost();
    setHost(host);

    await host.settings.getAll();
    await registerMenuNavigateListener(() => {});
    await openFilePicker();
    await checkOllamaStatus();

    expect(toast.info).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri (4)",
      expect.objectContaining({
        id: "unsupported-tauri",
        description:
          "settings.getAll, listen(menu:navigate), dialog.open, +1 more",
      }),
    );
  });

  test("interactive update check outside Tauri does not show 'Kalaido is up to date'", async () => {
    await checkForUpdatesAndPrompt(true);

    vi.advanceTimersByTime(100);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "Not supported outside Tauri",
      expect.objectContaining({
        id: "unsupported-tauri",
        description: "check_for_update",
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
