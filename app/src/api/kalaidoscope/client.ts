import PocketBase from "pocketbase";
import {
  getLocalKalaidoscopeAuthToken,
  getLocalKalaidoscopeStatus,
} from "@/api/app/local-scopes.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { getCloudJwt, getCloudRequestAuthHeaders } from "@/api/cloud/auth";
import { splitLocalNetLocator } from "@/api/kalaidoscope/local-url.ts";
import type { TypedPocketBase } from "@/api/kalaidoscope/types";
import { getActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client.ts";
import { toError } from "@/lib/errors.ts";

// Base URL of the cloud kalaidoscope gateway. No default: the cloud domains are
// written down once, in kalaido.sh, and reach the bundle through the
// environment. vite.config.ts refuses to build without them, so this throw is
// the backstop for a build that bypassed it.
const CLOUD_PB_URL = import.meta.env.VITEST ? "" : requireCloudPbUrl();

function requireCloudPbUrl(): string {
  const url = import.meta.env.VITE_CLOUD_PB_URL;
  if (!url) {
    throw new Error(
      "VITE_CLOUD_PB_URL is not set — build the app through ./kalaido.sh",
    );
  }
  // Every use below appends "/<cloudId>".
  return url.replace(/\/+$/, "");
}

export async function createKalaidoscopeClient(
  scope: KalaidoscopeMeta,
): Promise<TypedPocketBase> {
  switch (scope.type) {
    case "cloud":
      return createCloudClient(scope.locator);
    case "local_file":
      return createSidecarClient(scope);
    case "local_net":
      return await createLocalClient(scope.locator);
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
      if (status.phase === "running") {
        if (status.port) {
          port = status.port;
          break;
        }
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

  // Authenticate as the sidecar's seeded user
  if (tokenResult.value) {
    pb.authStore.save(tokenResult.value, null);
  }

  return pb;
}

/**
 * A `local_net` kalaidoscope points at a PocketBase instance the user runs
 * themselves, so its `locator` is a URL (unlike `local_file`, whose locator is a
 * filesystem path consumed by `createSidecarClient` above).
 *
 * Authentication is not optional here. Every collection's list rule is
 * `@request.auth.id != ''` (`migrations/1748000000_init_schema.go`), and
 * PocketBase applies list rules as a *filter* rather than a gate: an anonymous
 * client gets `200 OK` with zero rows, not a 403. Without credentials the app
 * looks like an empty kalaidoscope with nothing to indicate anything is wrong.
 *
 * Credentials travel in the locator's userinfo and are split back out here —
 * both because `fetch` refuses a URL containing userinfo ("Request cannot be
 * constructed from a URL that includes credentials"), and because `baseURL` is
 * used as an SWR cache key.
 *
 * Authenticating as `users` rather than `_superusers` is deliberate: `pinned_by`
 * is a relation to `users`, so a superuser id fails relation validation when
 * `synthesis.go` writes `e.Auth.Id` into it.
 *
 * Re-authenticating from stored credentials on every connect is why no token
 * refresh plumbing is needed here, unlike the sidecar and cloud paths.
 */
async function createLocalClient(locator: string): Promise<TypedPocketBase> {
  const { baseUrl, identity, password } = splitLocalNetLocator(locator);
  const pb = new PocketBase(baseUrl) as TypedPocketBase;

  if (identity && password) {
    try {
      await pb.collection("users").authWithPassword(identity, password);
    } catch (e) {
      throw new Error(
        `Could not sign in to ${baseUrl} as ${identity} — check the credentials in the kalaidoscope URL. (${toError(e).message})`,
      );
    }
  }

  return pb;
}

async function createCloudClient(cloudId: string): Promise<TypedPocketBase> {
  // Fail fast for signed-out users (app-router catches → BootError).
  await requireCloudJwt();

  const pb = new PocketBase(resolveCloudUrl(cloudId)) as TypedPocketBase;
  attachCloudAuth(pb);
  return pb;
}

function resolveCloudUrl(cloudId: string): string {
  return `${CLOUD_PB_URL}/${cloudId}`;
}

async function requireCloudJwt(): Promise<string> {
  const jwt = await getCloudJwt();
  if (jwt.isErr()) {
    throw new Error("Sign in to your cloud account to open this kalaidoscope.");
  }
  return jwt.value;
}

function attachCloudAuth(pb: TypedPocketBase): void {
  pb.beforeSend = async (url, options) => {
    const jwt = (await getCloudJwt()).unwrapOr(null);
    options.headers = {
      ...(options.headers ?? {}),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    };
    return { url, options };
  };
}

/**
 * Auth headers for a raw `fetch` to a kalaidoscope's custom routes (chat,
 * import, …). Cloud kalaidoscopes get the better-auth JWT; local ones send the
 * PocketBase token held by the active client.
 *
 * These routes serve anonymous callers, so this is about attribution rather
 * than access: `synthesis.go` nil-checks `e.Auth` and silently skips pinning
 * without it.
 */
export async function kalaidoscopeAuthHeaders(
  baseURL: string,
): Promise<Record<string, string>> {
  if (baseURL.startsWith(`${CLOUD_PB_URL}/`)) {
    return (await getCloudRequestAuthHeaders()).unwrapOr({});
  }

  // Every caller derives `baseURL` from the active client, so its authStore is
  // the matching credential.
  const token = getActiveKalaidoscopeClient()?.authStore.token;
  return token ? { Authorization: token } : {};
}
