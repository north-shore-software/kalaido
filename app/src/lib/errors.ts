import { ClientResponseError } from "pocketbase";

/**
 * Coerce an unknown thrown value into an Error with the most useful message,
 * normalizing across our three backend clients:
 *  - Tauri `invoke` rejects with a plain string.
 *  - PocketBase throws ClientResponseError, whose top-level `.message` is often
 *    generic ("Something went wrong.") while the real per-field validation
 *    detail sits in `.response.data`.
 *  - better-auth / fetch throw standard Error / DOMException (e.g. AbortError),
 *    which we pass through untouched so callers can still detect them by type.
 */
export function toError(e: unknown): Error {
  if (e instanceof ClientResponseError) {
    const detail = pocketbaseMessage(e);
    return detail ? new Error(detail) : e; // keep original (preserves abort/connection fallbacks)
  }
  if (e instanceof Error) return e; // better-auth, DOMException, generic
  if (typeof e === "string") return new Error(e); // Tauri
  return new Error(JSON.stringify(e)); // last-resort fallback
}

/** Prefer PocketBase per-field validation messages, else the response message. */
function pocketbaseMessage(e: ClientResponseError): string | null {
  const data = e.response?.data as
    | Record<string, { message?: string }>
    | undefined;
  if (data && typeof data === "object") {
    const parts = Object.entries(data)
      .map(([field, v]) => (v?.message ? `${field}: ${v.message}` : null))
      .filter((p): p is string => p !== null);
    if (parts.length) return parts.join("; ");
  }
  const msg = e.response?.message;
  return typeof msg === "string" && msg ? msg : null;
}
