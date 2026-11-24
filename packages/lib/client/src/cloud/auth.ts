import { createAuthClient } from "better-auth/client";
import { jwtDecode } from "jwt-decode";
import { err, ok, type Result } from "neverthrow";
import { getAuthUrl, onClientConfigChange } from "#config";
import { toError } from "#lib/errors";

const SESSION_TOKEN_KEY = "kalaido.cloud.session-token";
const JWT_EXPIRY_SKEW_S = 30;

let cachedJwt: { token: string; exp: number } | null = null;
let inflightJwt: Promise<Result<string, Error>> | null = null;

function readSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function cacheJwt(token: string): void {
  try {
    cachedJwt = { token, exp: jwtDecode(token).exp ?? 0 };
  } catch {
    cachedJwt = null;
  }
}

function buildAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    fetchOptions: {
      auth: { type: "Bearer", token: () => readSessionToken() ?? undefined },
      onSuccess: (ctx) => {
        const sessionToken = ctx.response.headers.get("set-auth-token");
        if (sessionToken) {
          try {
            window.localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
          } catch {}
          cachedJwt = null;
        }
        const jwt = ctx.response.headers.get("set-auth-jwt");
        if (jwt) cacheJwt(jwt);
        const url = String(ctx.request.url);
        if (url.includes("/sign-out")) {
          dropCloudSession();
        } else if (
          url.includes("/get-session") &&
          ctx.data === null &&
          !sessionToken
        ) {
          const current = readSessionToken();
          if (
            current &&
            ctx.request.headers.get("authorization") === `Bearer ${current}`
          ) {
            dropCloudSession();
          }
        }
      },
    },
  });
}

export type CloudAuthClient = ReturnType<typeof buildAuthClient>;

let cachedClient: CloudAuthClient | null = null;

onClientConfigChange(() => {
  cachedClient = null;
  cachedJwt = null;
  inflightJwt = null;
});

export function getAuthClient(): CloudAuthClient {
  if (!cachedClient) {
    cachedClient = buildAuthClient(getAuthUrl());
  }
  return cachedClient;
}

export function getCloudSessionAtom() {
  return getAuthClient().$store.atoms.session;
}

export function dropCloudSession(): void {
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {}
  cachedJwt = null;
  const sessionAtom = cachedClient?.$store.atoms.session;
  if (sessionAtom) {
    const current = sessionAtom.get();
    sessionAtom.set({
      ...current,
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
    });
  }
}

export function getCloudSessionToken(): Result<string, Error> {
  const token = readSessionToken();
  return token
    ? ok(token)
    : err(new Error("Not signed in to a cloud account."));
}

export async function getCloudJwt(): Promise<Result<string, Error>> {
  if (cachedJwt && cachedJwt.exp - JWT_EXPIRY_SKEW_S > Date.now() / 1000) {
    return ok(cachedJwt.token);
  }
  inflightJwt ??= fetchFreshJwt().finally(() => {
    inflightJwt = null;
  });
  return inflightJwt;
}

async function fetchFreshJwt(): Promise<Result<string, Error>> {
  const session = getCloudSessionToken();
  if (session.isErr()) return err(session.error);
  try {
    const res = await getAuthClient().$fetch<{ token: string }>("/token", {
      method: "GET",
    });
    if (res.error) {
      const { status, message } = res.error;
      if (status === 401 || status === 403) {
        dropCloudSession();
        return err(new Error("Cloud session expired. Please sign in again."));
      }
      return err(
        new Error(message ?? `Cloud token request failed (${status}).`),
      );
    }
    const token = res.data?.token;
    if (!token) return err(new Error("Auth server returned no token."));
    cacheJwt(token);
    return ok(token);
  } catch (e) {
    return err(toError(e));
  }
}

export async function getCloudRequestAuthHeaders(): Promise<
  Result<Record<string, string>, Error>
> {
  return (await getCloudJwt()).map((jwt) => ({
    Authorization: `Bearer ${jwt}`,
  }));
}

export interface EmailCredentials {
  email: string;
  password: string;
}

export type CloudUser = CloudAuthClient["$Infer"]["Session"]["user"];
export type CloudSession = CloudAuthClient["$Infer"]["Session"];

export async function signInWithEmail(
  credentials: EmailCredentials,
): Promise<Result<CloudUser, Error>> {
  dropCloudSession();
  try {
    const res = await getAuthClient().signIn.email(credentials);
    if (res.error) {
      return err(new Error(res.error.message ?? "Sign in failed"));
    }
    if (!readSessionToken()) {
      dropCloudSession();
      return err(
        new Error(
          "Sign in succeeded, but the server returned no session token.",
        ),
      );
    }
    return ok(res.data.user);
  } catch (e) {
    return err(toError(e));
  }
}

export async function signUpWithEmail(
  credentials: EmailCredentials,
): Promise<Result<CloudUser, Error>> {
  dropCloudSession();
  try {
    const res = await getAuthClient().signUp.email({
      ...credentials,
      name: "",
    });
    if (res.error) {
      return err(new Error(res.error.message ?? "Sign up failed"));
    }
    if (!readSessionToken()) {
      dropCloudSession();
      return err(
        new Error(
          "Sign up succeeded, but the server returned no session token.",
        ),
      );
    }
    return ok(res.data.user);
  } catch (e) {
    return err(toError(e));
  }
}

export async function signOutCloudAuth(): Promise<void> {
  await getAuthClient().signOut();
}
