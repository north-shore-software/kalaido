import { ok } from "neverthrow";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SidecarStatus } from "@/api/app/local-scopes.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { restoreKalaidoscope } from "./restore-kalaidoscope";

// Mock setAppStage
const mockSetAppStage = vi.fn();
vi.mock("@/hooks/app-state-actions.ts", () => ({
  setAppStage: (stage: unknown) => mockSetAppStage(stage),
}));

// Mock switchLocalKalaidoscope
const mockSwitchLocalKalaidoscope = vi.fn();
vi.mock("@/lib/local-kalaidoscope.ts", () => ({
  switchLocalKalaidoscope: (id: string) => mockSwitchLocalKalaidoscope(id),
}));

// Mock local scopes status listener
let statusListenerCb: ((status: SidecarStatus) => void) | null = null;
let listenerRegisteredAt = 0;
let restoreBackupCalledAt = 0;

vi.mock("@/api/app/local-scopes.ts", () => ({
  registerSidecarStatusChangeListener: vi.fn(
    async (cb: (status: SidecarStatus) => void) => {
      listenerRegisteredAt = Date.now();
      statusListenerCb = cb;
      return ok(() => {
        statusListenerCb = null;
      });
    },
  ),
}));

// Mock backups API
const mockRestoreBackup = vi.fn();
const mockGetRestoreStatus = vi.fn();
const mockWaitForCloudRestart = vi.fn();

vi.mock("@/api/kalaidoscope/backups.ts", () => ({
  restoreBackup: vi.fn(async (...args: unknown[]) => {
    restoreBackupCalledAt = Date.now();
    return mockRestoreBackup(...args);
  }),
  getRestoreStatus: vi.fn(async (...args: unknown[]) =>
    mockGetRestoreStatus(...args),
  ),
  waitForCloudRestart: vi.fn(async (...args: unknown[]) =>
    mockWaitForCloudRestart(...args),
  ),
}));

// Mock active client
vi.mock("@/api/kalaidoscope/_active.ts", () => ({
  activeClient: vi.fn(() => ok({ baseURL: "https://cloud.kalaido.test" })),
}));

describe("restoreKalaidoscope", () => {
  const localMeta: KalaidoscopeMeta = {
    id: "scope-local",
    displayName: "Local Scope",
    type: "local_file",
    locator: "/path/to/local",
  };

  const cloudMeta: KalaidoscopeMeta = {
    id: "scope-cloud",
    displayName: "Cloud Scope",
    type: "cloud",
    locator: "scope-cloud-id",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    statusListenerCb = null;
    listenerRegisteredAt = 0;
    restoreBackupCalledAt = 0;
  });

  test("success (local): registers listener before request, reopens, and checks last_restore", async () => {
    mockRestoreBackup.mockImplementation(async () => {
      // Sidecar receives request and will emit stopped
      setTimeout(() => {
        if (statusListenerCb) {
          statusListenerCb({
            phase: "stopped",
            id: localMeta.id,
            message: null,
          });
        }
      }, 10);
      return ok(undefined);
    });

    mockSwitchLocalKalaidoscope.mockResolvedValue(ok(undefined));
    mockGetRestoreStatus.mockResolvedValue(
      ok({
        boot_id: "boot-2",
        last_restore: {
          id: "backup-1.zip",
          ok: true,
          finished_at: "2026-10-01T20:00:00Z",
        },
      }),
    );

    const result = await restoreKalaidoscope(localMeta, "backup-1.zip");

    expect(result.isOk()).toBe(true);
    expect(listenerRegisteredAt).toBeGreaterThan(0);
    expect(listenerRegisteredAt).toBeLessThanOrEqual(restoreBackupCalledAt);
    expect(mockSetAppStage).toHaveBeenCalledWith({
      stage: "kalaidoscope_loading",
    });
    expect(mockSwitchLocalKalaidoscope).toHaveBeenCalledWith(localMeta.id);
  });

  test("success (cloud): polls restore-status until boot_id changes, reopens, and checks last_restore", async () => {
    mockGetRestoreStatus
      .mockResolvedValueOnce(
        ok({
          boot_id: "boot-1",
          last_restore: null,
        }),
      )
      .mockResolvedValueOnce(
        ok({
          boot_id: "boot-2",
          last_restore: {
            id: "cloud-backup.zip",
            ok: true,
            finished_at: "2026-10-01T20:00:00Z",
          },
        }),
      );

    mockRestoreBackup.mockResolvedValue(ok(undefined));
    mockWaitForCloudRestart.mockResolvedValue(true);
    mockSwitchLocalKalaidoscope.mockResolvedValue(ok(undefined));

    const result = await restoreKalaidoscope(cloudMeta, "cloud-backup.zip");

    expect(result.isOk()).toBe(true);
    expect(mockWaitForCloudRestart).toHaveBeenCalledWith(
      "https://cloud.kalaido.test",
      "boot-1",
      120_000,
    );
    expect(mockSwitchLocalKalaidoscope).toHaveBeenCalledWith(cloudMeta.id);
  });

  test("backend failure: reports backend error and 'Your workspace is unchanged.'", async () => {
    mockRestoreBackup.mockImplementation(async () => {
      setTimeout(() => {
        if (statusListenerCb) {
          statusListenerCb({
            phase: "stopped",
            id: localMeta.id,
            message: null,
          });
        }
      }, 10);
      return ok(undefined);
    });

    mockSwitchLocalKalaidoscope.mockResolvedValue(ok(undefined));
    mockGetRestoreStatus.mockResolvedValue(
      ok({
        boot_id: "boot-2",
        last_restore: {
          id: "backup-fail.zip",
          ok: false,
          error: "archive has invalid signature",
          finished_at: "2026-10-01T20:00:00Z",
        },
      }),
    );

    const result = await restoreKalaidoscope(localMeta, "backup-fail.zip");

    expect(result.isErr()).toBe(true);
    expect(mockSetAppStage).toHaveBeenCalledWith({
      stage: "kalaidoscope_load_error",
      error: {
        message: "archive has invalid signature\nYour workspace is unchanged.",
      },
      retryKalaidoscopeId: localMeta.id,
    });
  });

  test("timeout: shows timeout load error when sidecar does not stop", async () => {
    // Fake timers to avoid 120s real delay
    vi.useFakeTimers();

    mockRestoreBackup.mockResolvedValue(ok(undefined));

    const promise = restoreKalaidoscope(localMeta, "backup-timeout.zip");

    // Advance 120s timeout
    await vi.advanceTimersByTimeAsync(121_000);

    const result = await promise;

    expect(result.isErr()).toBe(true);
    expect(mockSetAppStage).toHaveBeenCalledWith({
      stage: "kalaidoscope_load_error",
      error: {
        message: "The restore did not complete. Your workspace is unchanged.",
      },
      retryKalaidoscopeId: localMeta.id,
    });

    vi.useRealTimers();
  });

  test("id mismatch: treated as timeout", async () => {
    mockRestoreBackup.mockImplementation(async () => {
      setTimeout(() => {
        if (statusListenerCb) {
          statusListenerCb({
            phase: "stopped",
            id: localMeta.id,
            message: null,
          });
        }
      }, 10);
      return ok(undefined);
    });

    mockSwitchLocalKalaidoscope.mockResolvedValue(ok(undefined));
    // Outcome id does not match requested backup id
    mockGetRestoreStatus.mockResolvedValue(
      ok({
        boot_id: "boot-2",
        last_restore: {
          id: "different-backup.zip",
          ok: true,
          finished_at: "2026-10-01T20:00:00Z",
        },
      }),
    );

    const result = await restoreKalaidoscope(localMeta, "requested-backup.zip");

    expect(result.isErr()).toBe(true);
    expect(mockSetAppStage).toHaveBeenCalledWith({
      stage: "kalaidoscope_load_error",
      error: {
        message: "The restore did not complete. Your workspace is unchanged.",
      },
      retryKalaidoscopeId: localMeta.id,
    });
  });
});
