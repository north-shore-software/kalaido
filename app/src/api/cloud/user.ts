import { err, ok, type Result } from "neverthrow";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { toError } from "@/lib/errors";
import { AUTH_URL, getCloudSessionToken } from "./auth";

/** The cloudId is already registered to another user. */
export class CloudIdTakenError extends Error {
  constructor(message = "That kalaidoscope ID is already taken.") {
    super(message);
    this.name = "CloudIdTakenError";
  }
}

// Registry routes live at the auth worker root (not under /api/auth) and
// authenticate with the session bearer token, same as billing.
async function registryFetch(
  path: string,
  init?: RequestInit,
): Promise<Result<Response, Error>> {
  const session = getCloudSessionToken();
  if (session.isErr()) return err(session.error);
  try {
    const res = await fetch(`${AUTH_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value}`,
        ...(init?.headers ?? {}),
      },
    });
    return ok(res);
  } catch (e) {
    return err(toError(e));
  }
}

async function serverError(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) {
    return new Error("Cloud session expired. Please sign in again.");
  }
  // `error` is only a message when a route wrote it. A request the validator
  // rejects carries the whole zod result there instead, an object.
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return new Error(typeof data.error === "string" ? data.error : fallback);
}

/**
 * Registers a cloud kalaidoscope to the signed-in user (first-come on cloudId).
 */
export async function createCloudKalaidoscope(
  cloudId: string,
  name?: string,
): Promise<Result<void, Error>> {
  const res = await registryFetch("/kalaidoscopes", {
    method: "POST",
    body: JSON.stringify({ cloudId, ...(name ? { name } : {}) }),
  });
  if (res.isErr()) return err(res.error);
  if (res.value.ok) return ok(undefined);
  if (res.value.status === 409) return err(new CloudIdTakenError());
  if (res.value.status === 400) {
    return err(await serverError(res.value, "Invalid kalaidoscope ID."));
  }
  return err(
    await serverError(
      res.value,
      `Could not create the cloud kalaidoscope (${res.value.status}).`,
    ),
  );
}

export interface CloudIdAvailability {
  available: boolean;
  suggestion?: string;
}

export async function checkCloudIdAvailability(
  cloudId: string,
): Promise<Result<CloudIdAvailability, Error>> {
  const res = await registryFetch(
    `/kalaidoscopes/available?cloudId=${encodeURIComponent(cloudId)}`,
    { method: "GET" },
  );
  if (res.isErr()) return err(res.error);
  if (!res.value.ok) {
    return err(
      await serverError(
        res.value,
        `Could not check the kalaidoscope ID (${res.value.status}).`,
      ),
    );
  }
  const data = (await res.value.json().catch(() => null)) as {
    available?: boolean;
    suggestion?: string;
  } | null;
  if (!data || typeof data.available !== "boolean") {
    return err(new Error("Auth server returned an unexpected response."));
  }
  return ok({ available: data.available, suggestion: data.suggestion });
}

export async function listCloudKalaidoscopes(): Promise<
  Result<KalaidoscopeMeta[], Error>
> {
  const res = await registryFetch("/kalaidoscopes", { method: "GET" });
  if (res.isErr()) return err(res.error);
  if (!res.value.ok) {
    return err(
      await serverError(
        res.value,
        `Could not list cloud kalaidoscopes (${res.value.status}).`,
      ),
    );
  }
  const data = (await res.value.json().catch(() => null)) as {
    kalaidoscopes?: {
      id: string;
      name?: string | null;
      archivedAt?: string | null;
    }[];
  } | null;
  if (!data || !Array.isArray(data.kalaidoscopes)) {
    return err(new Error("Auth server returned an unexpected response."));
  }
  return ok(
    data.kalaidoscopes.map((row) => ({
      id: row.id,
      type: "cloud" as const,
      locator: row.id,
      displayName: row.name ?? row.id,
      archivedAt: row.archivedAt ?? undefined,
    })),
  );
}

export async function setCloudArchived(
  cloudId: string,
  archived: boolean,
): Promise<Result<void, Error>> {
  const res = await registryFetch(
    `/kalaidoscopes/${encodeURIComponent(cloudId)}`,
    { method: "PATCH", body: JSON.stringify({ archived }) },
  );
  if (res.isErr()) return err(res.error);
  if (res.value.ok) return ok(undefined);
  return err(
    await serverError(
      res.value,
      `Could not update the cloud kalaidoscope (${res.value.status}).`,
    ),
  );
}
