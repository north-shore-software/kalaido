// Backend wrappers for the kalaidoscope ingest flow. These are framework-free
// helpers around the PocketBase backend; the React hooks (use-note-ingest /
// use-file-ingest) own the UI state and call into here.
//
// The backend exposes two paths:
//   - Sync  — POST /api/ingest: one text entry, created immediately (ingestNote).
//   - Batch — the `ingest` collection: multipart file upload, processed async
//     (ingestFile, then subscribeIngest / getIngest for realtime progress).
import { err, ok, type Result } from "neverthrow";
import { readLocalFileFromDisk } from "@/api/app/ingest-file";
import { activeClient, toError } from "./_active";
import { kalaidoscopeAuthHeaders } from "./client";
import type { IngestResponse } from "./types";

/** Lifecycle of an ingest run, shared by both ingest hooks. */
export type IngestPhase = "idle" | "running" | "done" | "error" | "cancelled";

/** File formats the backend's batch ingest understands. */
export type ImportFormat = "mbox" | "text" | "zip" | "docx";

/**
 * Sync single-entry ingest: POSTs one inline text entry to `/api/ingest`, which
 * creates a fragment and returns immediately. `kalaidoscopeAuthHeaders` is a
 * no-op for local kalaidoscopes, so the same fetch covers local and cloud.
 */
export async function ingestNote(
  content: string,
  type = "note",
  skipDuplicates = false,
  signal?: AbortSignal,
): Promise<Result<void, Error>> {
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
        content,
        type,
        skip_duplicates: skipDuplicates,
      }),
      signal,
    });
    if (!res.ok) {
      let msg = `Ingest failed: ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) msg = body.message;
      } catch {}
      return err(new Error(msg));
    }
    return ok(undefined);
  } catch (e) {
    return err(toError(e));
  }
}

export interface FileIngestOptions {
  path: string;
  /** Format override; omit to let the backend infer it per file from the filename. */
  format?: ImportFormat;
  limit?: number;
  extensions?: string;
  skipDuplicates?: boolean;
  organizeAfter?: boolean;
}

/**
 * Progress snapshot of an `ingest` record. `status` is the backend lifecycle:
 * "pending" → "done" / "error". There is no running total, so callers treat
 * progress as indeterminate until a terminal status arrives.
 */
export interface IngestStatus {
  id: string;
  status: string;
  ingested: number;
  error: string;
}

function toStatus(r: IngestResponse): IngestStatus {
  return {
    id: r.id,
    status: r.status ?? "",
    ingested: r.ingested ?? 0,
    error: r.error ?? "",
  };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Reads `path` off disk and creates a record in the async `ingest` collection
 * (multipart). The whole file is uploaded as-is — the backend expands archives
 * and parses. Returns the new record's initial status so the caller can
 * subscribe to its realtime progress.
 */
export async function ingestFile(
  opts: FileIngestOptions,
  signal?: AbortSignal,
): Promise<Result<IngestStatus, Error>> {
  const client = activeClient();
  if (client.isErr()) return err(client.error);

  const bytes = await readLocalFileFromDisk(opts.path);
  if (bytes.isErr()) return err(bytes.error);

  try {
    const form = new FormData();
    form.append("file", new Blob([bytes.value]), basename(opts.path));
    if (opts.format) form.append("format", opts.format);
    if (opts.limit) form.append("limit", String(opts.limit));
    if (opts.extensions) form.append("extensions", opts.extensions);
    form.append("skip_duplicates", opts.skipDuplicates ? "true" : "false");
    if (opts.organizeAfter) form.append("organize_after", "true");

    const record = await client.value
      .collection("ingest")
      .create(form, { signal });
    return ok(toStatus(record));
  } catch (e) {
    return err(toError(e));
  }
}

export async function subscribeIngest(
  recordId: string,
  onChange: (status: IngestStatus) => void,
): Promise<Result<() => void, Error>> {
  const client = activeClient();
  if (client.isErr()) return err(client.error);
  try {
    const unsub = await client.value
      .collection("ingest")
      .subscribe(recordId, (e) => onChange(toStatus(e.record)));
    return ok(unsub);
  } catch (e) {
    return err(toError(e));
  }
}

export async function getIngest(
  recordId: string,
): Promise<Result<IngestStatus, Error>> {
  const client = activeClient();
  if (client.isErr()) return err(client.error);
  try {
    const record = await client.value.collection("ingest").getOne(recordId);
    return ok(toStatus(record));
  } catch (e) {
    return err(toError(e));
  }
}
