import PocketBase from "pocketbase";
import { getCloudJwt, getCloudRequestAuthHeaders } from "#cloud/auth";
import { getCloudPbUrl } from "#config";
import { splitLocalNetLocator } from "#kalaidoscope/local-url";
import type { TypedPocketBase } from "#kalaidoscope/types";
import { getActiveKalaidoscopeClient } from "#lib/active-kalaidoscope-client";
import { toError } from "#lib/errors";

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

export async function createCloudClient(
  cloudId: string,
): Promise<TypedPocketBase> {
  await requireCloudJwt();

  const pb = new PocketBase(resolveCloudUrl(cloudId)) as TypedPocketBase;
  attachCloudAuth(pb);
  return pb;
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
