import PocketBase, { ClientResponseError } from "pocketbase";
import { getCloudJwt, getCloudRequestAuthHeaders } from "#cloud/auth";
import { getCloudPbUrl } from "#config";
import { splitLocalNetLocator } from "#kalaidoscope/local-url";
import type { TypedPocketBase } from "#kalaidoscope/types";
import { getActiveKalaidoscopeClient } from "#lib/active-kalaidoscope-client";
import { toError } from "#lib/errors";

const CLOUD_READY_MAX_ATTEMPTS = 30;
const CLOUD_READY_RETRY_DELAY_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export async function createCloudClient(
  cloudId: string,
  options: CreateCloudClientOptions = {},
): Promise<TypedPocketBase> {
  await requireCloudJwt();

  const pb = new PocketBase(resolveCloudUrl(cloudId)) as TypedPocketBase;
  attachCloudAuth(pb);
  await waitForCloudReady(pb, options);
  return pb;
}

async function waitForCloudReady(
  pb: TypedPocketBase,
  {
    maxAttempts = CLOUD_READY_MAX_ATTEMPTS,
    retryDelayMs = CLOUD_READY_RETRY_DELAY_MS,
  }: CreateCloudClientOptions,
): Promise<void> {
  let lastError: unknown;
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await pb.send("/api/health", { method: "GET", requestKey: null });
      return;
    } catch (e) {
      lastError = e;
      if (isFatalCloudStatusError(e) || attempt >= attempts) {
        break;
      }
      await sleep(retryDelayMs);
    }
  }

  throw lastError instanceof Error
    ? toError(lastError)
    : new Error("Timed out waiting for cloud workspace container to start.");
}

function isFatalCloudStatusError(e: unknown): boolean {
  if (!(e instanceof ClientResponseError)) return false;
  return (
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 408 &&
    e.status !== 425 &&
    e.status !== 429
  );
}

function resolveCloudUrl(cloudId: string): string {
  return `${getCloudPbUrl()}/${cloudId}`;
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
