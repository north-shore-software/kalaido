/**
 * Parsing for `local_net` locators — the URL a user types into Advanced >
 * Location to attach a kalaidoscope to a PocketBase instance they run
 * themselves (see `open/kalaidoscope/start.sh`).
 *
 * Credentials ride in the URL's userinfo (`http://user%40kalaido.local:pw@localhost:8899`)
 * so the whole connection is one pasteable string and needs no extra storage.
 * They must be split back out before the URL reaches PocketBase: `fetch` rejects
 * any URL carrying userinfo, so passing the locator through verbatim fails on
 * every request.
 */

export interface LocalNetLocator {
  /** Base URL with userinfo and trailing slashes removed — safe to hand to `fetch`. */
  baseUrl: string;
  /** PocketBase `users` identity, or null when the locator carried no credentials. */
  identity: string | null;
  password: string | null;
}

/**
 * Loopback-only, because the webview's connect-src is a static allowlist
 * (`src-tauri/tauri.conf.json`) and CSP cannot express arbitrary hosts or CIDR
 * ranges. Note `[::1]` is accepted here but is *not* in the CSP: CSP's
 * host-source grammar has no production for IPv6 literals, so it cannot be
 * allowlisted at all.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(h)
  );
}

/**
 * Canonical form to persist in `KalaidoscopeMeta.locator`: credentials kept,
 * trailing slashes dropped.
 *
 * The trailing slash matters. `new URL("http://x:1").toString()` appends one,
 * and while the PocketBase SDK normalises it away, the raw-`fetch` routes
 * (`/api/chat`, `/api/ingest`, `/api/context/tokens`) concatenate directly and
 * would produce `//api/…`, which Go's ServeMux answers with a 301 that can drop
 * a POST body.
 */
export function formatLocalNetLocator(url: URL): string {
  const auth = url.username
    ? `${url.username}${url.password ? `:${url.password}` : ""}@`
    : "";
  return `${url.protocol}//${auth}${url.host}${stripTrailingSlashes(url.pathname)}`;
}

/**
 * Split a stored locator into a fetchable base URL and its credentials.
 *
 * Also repairs locators persisted before this was normalised (trailing slash),
 * so no settings migration is needed.
 */
export function splitLocalNetLocator(locator: string): LocalNetLocator {
  const trimmed = locator.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Not a URL at all. Hand it back tidied and let PocketBase report the
    // failure rather than throwing from what callers treat as a pure parse.
    return {
      baseUrl: stripTrailingSlashes(trimmed),
      identity: null,
      password: null,
    };
  }

  // `username`/`password` are percent-encoded as typed; the seeded account is an
  // email, so its `@` arrives here as `%40`.
  const identity = url.username ? safeDecode(url.username) : null;
  const password = url.password ? safeDecode(url.password) : null;

  url.username = "";
  url.password = "";

  return {
    baseUrl: `${url.protocol}//${url.host}${stripTrailingSlashes(url.pathname)}`,
    identity,
    password,
  };
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

// A literal `%` in a password is legal in userinfo but not valid percent-encoding.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
