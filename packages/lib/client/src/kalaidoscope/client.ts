import PocketBase, { ClientResponseError } from "pocketbase";
import {
  CloudAuthRequiredError,
  dropCloudSession,
  getCloudJwt,
  getCloudRequestAuthHeaders,
} from "#cloud/auth";
import { getCloudPbUrl } from "#config";
import { splitLocalNetLocator } from "#kalaidoscope/local-url";
import type { TypedPocketBase } from "#kalaidoscope/types";
import { getActiveKalaidoscopeClient } from "#lib/active-kalaidoscope-client";
import { toError } from "#lib/errors";

const CLOUD_READY_TIMEOUT_MS = 60_000;
const CLOUD_READY_RETRY_DELAY_MS = 1_500;
const CLOUD_READY_ATTEMPT_TIMEOUT_MS = 5_000;

export { CloudAuthRequiredError };

export async function createLocalNetClient(
  locator: string,
): Promise<TypedPocketBase> {
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

export interface CreateCloudClientOptions {
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export async function createCloudClient(
  cloudId: string,
  options: CreateCloudClientOptions = {},
): Promise<TypedPocketBase> {
  const pb = new PocketBase(resolveCloudUrl(cloudId)) as TypedPocketBase;
  attachCloudAuth(pb);
  await waitForCloudReady(pb, cloudId, options);
  return pb;
}

async function waitForCloudReady(
  pb: TypedPocketBase,
  cloudId: string,
  {
    timeoutMs = CLOUD_READY_TIMEOUT_MS,
    retryDelayMs = CLOUD_READY_RETRY_DELAY_MS,
    attemptTimeoutMs = CLOUD_READY_ATTEMPT_TIMEOUT_MS,
    signal,
  }: CreateCloudClientOptions,
): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let lastError: unknown;

  while (true) {
    if (signal?.aborted) throw abortError(signal);

    const jwt = await getCloudJwt();
    if (jwt.isErr()) {
      if (jwt.error instanceof CloudAuthRequiredError) {
        throw new CloudAuthRequiredError(
          jwt.error.message === "Not signed in to a cloud account."
            ? "Sign in to your cloud account to open this kalaidoscope."
            : jwt.error.message,
        );
      }
      lastError = jwt.error;
    } else {
      try {
        await sendHealthProbe(pb, attemptTimeoutMs, signal);
        return;
      } catch (e) {
        if (signal?.aborted) throw abortError(signal);
        if (e instanceof ClientResponseError && e.status === 401) {
          dropCloudSession();
          throw new CloudAuthRequiredError(
            "Cloud session expired. Please sign in again.",
          );
        }
        if (isFatalCloudHealthError(e)) {
          throw formatFatalCloudError(e);
        }
        lastError = e;
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(retryDelayMs, remainingMs), signal);
  }

  const detail = formatLastAttemptError(lastError);
  const timeoutError = new Error(
    `Timed out waiting for cloud container (${cloudId}) to start.${detail ? ` (${detail})` : ""}`,
  );
  if (lastError instanceof Error && lastError.stack) {
    timeoutError.stack = `${timeoutError.name}: ${timeoutError.message}\n${lastError.stack}`;
  }
  throw timeoutError;
}

async function sendHealthProbe(
  pb: TypedPocketBase,
  attemptTimeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
  try {
    await pb.send("/api/health", {
      method: "GET",
      requestKey: null,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

function isFatalCloudHealthError(e: unknown): e is ClientResponseError {
  if (!(e instanceof ClientResponseError)) return false;
  return (
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 408 &&
    e.status !== 425 &&
    e.status !== 429
  );
}

function formatFatalCloudError(e: ClientResponseError): Error {
  const normalized = toError(e);
  if (
    normalized === e &&
    (!e.message || e.message === "Something went wrong.")
  ) {
    return new Error(`Cloud workspace returned HTTP ${e.status}.`);
  }
  return normalized;
}

function formatLastAttemptError(e: unknown): string | null {
  if (!e) return null;
  if (e instanceof ClientResponseError) {
    if (e.isAbort) return "request timed out";
    const msg =
      typeof e.response?.message === "string" && e.response.message
        ? e.response.message
        : null;
    if (e.status > 0) {
      return msg ? `HTTP ${e.status}: ${msg}` : `HTTP ${e.status}`;
    }
    return msg;
  }
  if (e instanceof Error && e.message) return e.message;
  return null;
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveCloudUrl(cloudId: string): string {
  return `${getCloudPbUrl()}/${cloudId}`;
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

export async function kalaidoscopeAuthHeaders(
  baseURL: string,
): Promise<Record<string, string>> {
  let cloudUrl: string | null = null;
  try {
    cloudUrl = getCloudPbUrl();
  } catch {
    cloudUrl = null;
  }

  if (cloudUrl && baseURL.startsWith(`${cloudUrl}/`)) {
    return (await getCloudRequestAuthHeaders()).unwrapOr({});
  }

  const token = getActiveKalaidoscopeClient()?.authStore.token;
  return token ? { Authorization: token } : {};
}
