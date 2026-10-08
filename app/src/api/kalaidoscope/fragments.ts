import { err, ok, type Result } from "neverthrow";
import { activeClient, toError, withActiveClient } from "./_active";
import { kalaidoscopeAuthHeaders } from "./client";
import type { FragmentTypeOptions } from "./types";

/**
 * Append a fragment to the kalaidoscope's ground truth. `occurredAt` defaults
 * server-side to the creation time. Resolves with the new fragment's id.
 */
export async function addFragment(
  type: FragmentTypeOptions,
  content: string,
  opts?: {
    source?: string;
    occurredAt?: string;
    ingestedVia?: string;
    title?: string;
  },
): Promise<Result<string, Error>> {
  const client = activeClient();
  if (client.isErr()) return err(client.error);
  const baseURL = client.value.baseURL;

  try {
    const res = await fetch(`${baseURL}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await kalaidoscopeAuthHeaders(baseURL)),
      },
      body: JSON.stringify({
        type,
        content,
        ingestedVia: opts?.ingestedVia ?? "app",
        source: opts?.source,
        occurredAt: opts?.occurredAt,
        title: opts?.title,
      }),
    });
    if (!res.ok) {
      let msg = `Ingest failed: ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) msg = body.message;
      } catch {}
      return err(new Error(msg));
    }
    const data = (await res.json()) as { fragmentId: string };
    return ok(data.fragmentId);
  } catch (e) {
    return err(toError(e));
  }
}

/**
 * Archive a fragment: it stays on disk and readable by id, but leaves the
 * stream and the whole-scope context. `unarchiveFragment` reverses it.
 */
export async function archiveFragment(
  id: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/fragments/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      requestKey: null,
    });
  });
}

export async function unarchiveFragment(
  id: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/fragments/${encodeURIComponent(id)}/unarchive`, {
      method: "POST",
      requestKey: null,
    });
  });
}

/** Bulk `archiveFragment`, in one transaction; already-archived ids are skipped. */
export async function archiveFragments(
  ids: string[],
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send("/api/fragments/archive", {
      method: "POST",
      requestKey: null,
      body: { ids },
    });
  });
}

export async function unarchiveFragments(
  ids: string[],
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send("/api/fragments/unarchive", {
      method: "POST",
      requestKey: null,
      body: { ids },
    });
  });
}

/** Name a fragment. An empty title clears the name; the stream then shows the annotation's. */
export async function renameFragment(
  id: string,
  title: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/fragments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      requestKey: null,
      body: { title },
    });
  });
}
