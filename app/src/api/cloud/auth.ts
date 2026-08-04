import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { jwtDecode } from "jwt-decode";
import { err, ok, type Result } from "neverthrow";
import { toError } from "@/lib/errors";

// No default: the cloud domains are written down once, in kalaido.sh, and reach
// the bundle through the environment. vite.config.ts refuses to build without
// them, so this throw is the backstop for a build that bypassed it.
export const AUTH_URL: string = requireAuthUrl();

function requireAuthUrl(): string {
  const url = import.meta.env.VITE_BETTER_AUTH_URL;
  if (!url) {
    throw new Error(
      "VITE_BETTER_AUTH_URL is not set — build the app through ./kalaido.sh",
    );
  }
  // user.ts concatenates this with a leading-slash path.
  return url.replace(/\/+$/, "");
}

// Session persistence uses better-auth's bearer pattern instead of cookies:
// the tauri://localhost origin can't reliably hold cross-origin cookies, so we
// capture the `set-auth-token` response header and replay it from localStorage.
const SESSION_TOKEN_KEY = "kalaido.cloud.session-token";

function readSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

// Short-lived JWT cache. PocketBase's beforeSend calls getCloudJwt() on every
// request, so we hold the token until ~30s before expiry and share one
// in-flight refresh across concurrent callers.
const JWT_EXPIRY_SKEW_S = 30;
let cachedJwt: { token: string; exp: number } | null = null;
let inflightJwt: Promise<Result<string, Error>> | null = null;

function cacheJwt(token: string): void {
  try {
    cachedJwt = { token, exp: jwtDecode(token).exp ?? 0 };
  } catch {
    cachedJwt = null;
  }
}

function clearAuthState(): void {
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {}
  cachedJwt = null;
}

export const authClient = createAuthClient({
  baseURL: AUTH_URL,
  plugins: [anonymousClient()],
  fetchOptions: {
    // Header is skipped entirely when the token callback returns undefined.
    auth: { type: "Bearer", token: () => readSessionToken() ?? undefined },
    onSuccess: (ctx) => {
      // bearer() echoes the (possibly rotated) session token on sign-in/up
      // and session refresh.
      const sessionToken = ctx.response.headers.get("set-auth-token");
      if (sessionToken) {
        try {
          window.localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
        } catch {}
        cachedJwt = null; // JWT minted under the old session is now suspect
      }
      // jwt() exposes a fresh JWT on session responses — free cache fill.
      const jwt = ctx.response.headers.get("set-auth-jwt");
      if (jwt) cacheJwt(jwt);
      if (String(ctx.request.url).includes("/sign-out")) clearAuthState();
    },
  },
});

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
    const res = await authClient.$fetch<{ token: string }>("/token", {
      method: "GET",
    });
    if (res.error) {
      const { status, message } = res.error;
      if (status === 401 || status === 403) {
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

/**
 * Auth headers for a raw `fetch` to the ACTIVE kalaidoscope's custom routes.
 */
export async function getCloudRequestAuthHeaders(): Promise<
  Result<Record<string, string>, Error>
> {
  return (await getCloudJwt()).map((jwt) => ({
    Authorization: `Bearer ${jwt}`,
  }));
}
