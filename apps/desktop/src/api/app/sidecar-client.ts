import {
  createCloudClient,
  createLocalNetClient,
} from "@kalaido/client/kalaidoscope/client";
import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { jwtDecode } from "jwt-decode";
import PocketBase, { type RecordModel } from "pocketbase";
import {
  getLocalKalaidoscopeAuthToken,
  getLocalKalaidoscopeStatus,
} from "@/api/app/local-scopes";

export async function createKalaidoscopeClient(
  scope: KalaidoscopeMeta,
  options?: { signal?: AbortSignal },
): Promise<TypedPocketBase> {
  switch (scope.type) {
    case "cloud":
      return createCloudClient(scope.locator, { signal: options?.signal });
    case "local_file":
      return createSidecarClient(scope);
    case "local_net":
      return createLocalNetClient(scope.locator);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createSidecarClient(
  scope: KalaidoscopeMeta,
): Promise<TypedPocketBase> {
  let retries = 0;
  const maxRetries = 50;
  const delayMs = 200;
  let port: number | null = null;

  while (retries < maxRetries) {
    const statusResult = await getLocalKalaidoscopeStatus(scope.id);

    if (statusResult.isOk()) {
      const status = statusResult.value;
      if (status.phase === "running" && status.port) {
        port = status.port;
        break;
      }
      if (status.phase === "failed") {
        throw new Error(
          `Local sidecar failed to start: ${status.message || "Unknown error"}`,
        );
      }
    }

    await sleep(delayMs);
    retries++;
  }

  if (!port) {
    throw new Error(
      "Timeout waiting for local sidecar to start or port assignment failed",
    );
  }

  const tokenResult = await getLocalKalaidoscopeAuthToken(scope.id);
  if (tokenResult.isErr()) {
    throw new Error(
      `Failed to retrieve local auth token: ${tokenResult.error.message}`,
    );
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const pb = new PocketBase(baseUrl) as TypedPocketBase;

  if (tokenResult.value) {
    let model: RecordModel | null = null;
    try {
      const decoded = jwtDecode<{ id?: string }>(tokenResult.value);
      if (decoded.id) {
        model = { id: decoded.id } as RecordModel;
      }
    } catch {}
    pb.authStore.save(tokenResult.value, model);
  }

  return pb;
}
