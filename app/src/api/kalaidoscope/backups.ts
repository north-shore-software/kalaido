import { ClientResponseError } from "pocketbase";
import type { Result } from "neverthrow";
import type { TypedPocketBase } from "@/api/kalaidoscope/types";
import { withActiveClient } from "./_active";
import { kalaidoscopeAuthHeaders } from "./client";

export type BackupKind = "manual" | "scheduled" | "pre-restore";

export interface BackupSummary {
  id: string;
  kind: BackupKind;
  created_at: string;
  size_bytes: number;
}

export interface RestoreOutcome {
  id: string;
  ok: boolean;
  error?: string;
  finished_at: string;
}

export interface RestoreStatusResponse {
  boot_id: string;
  last_restore: RestoreOutcome | null;
}

export function backupDownloadUrl(baseURL: string, id: string): string {
  const base = baseURL.replace(/\/+$/, "");
  return `${base}/api/kalaidoscope/backups/${id}/download`;
}

export async function waitForCloudRestart(
  baseURL: string,
  initialBootId: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  const base = baseURL.replace(/\/+$/, "");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const headers = await kalaidoscopeAuthHeaders(baseURL);
      const res = await fetch(
        `${base}/api/kalaidoscope/backups/restore-status`,
        {
          headers,
          signal: controller.signal,
        },
      );
      if (res.status === 200) {
        const body = (await res.json()) as RestoreStatusResponse;
        if (body.boot_id && body.boot_id !== initialBootId) {
          clearTimeout(timer);
          return true;
        }
      }
    } catch {
      // Treat connection errors / timeouts as "still restarting"
    } finally {
      clearTimeout(timer);
    }

    if (Date.now() >= deadline) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return false;
}

export async function waitForCloudHealthy(
  baseURL: string,
  timeoutMs: number,
): Promise<boolean> {
  const base = baseURL.replace(/\/+$/, "");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const headers = await kalaidoscopeAuthHeaders(baseURL);
      const res = await fetch(`${base}/api/health`, {
        headers,
        signal: controller.signal,
      });
      if (res.status === 200) {
        clearTimeout(timer);
        return true;
      }
    } catch {
    } finally {
      clearTimeout(timer);
    }

    if (Date.now() >= deadline) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return false;
}

async function sendRequest<T>(
  client: TypedPocketBase,
  path: string,
  options: { method: string; requestKey?: null },
): Promise<T> {
  try {
    return await client.send<T>(path, {
      ...options,
      requestKey: null,
    });
  } catch (e) {
    if (e instanceof ClientResponseError && e.response?.message) {
      throw new Error(e.response.message);
    }
    throw e;
  }
}

export async function listBackups(): Promise<Result<BackupSummary[], Error>> {
  return withActiveClient(async (client) => {
    return sendRequest<BackupSummary[]>(client, "/api/kalaidoscope/backups", {
      method: "GET",
    });
  });
}

export async function createBackup(): Promise<Result<BackupSummary, Error>> {
  return withActiveClient(async (client) => {
    return sendRequest<BackupSummary>(client, "/api/kalaidoscope/backups", {
      method: "POST",
    });
  });
}

export async function restoreBackup(id: string): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    return sendRequest<void>(
      client,
      `/api/kalaidoscope/backups/${id}/restore`,
      {
        method: "POST",
      },
    );
  });
}

export async function deleteBackup(id: string): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    return sendRequest<void>(client, `/api/kalaidoscope/backups/${id}`, {
      method: "DELETE",
    });
  });
}

export async function getRestoreStatus(): Promise<
  Result<RestoreStatusResponse, Error>
> {
  return withActiveClient(async (client) => {
    return sendRequest<RestoreStatusResponse>(
      client,
      "/api/kalaidoscope/backups/restore-status",
      { method: "GET" },
    );
  });
}
