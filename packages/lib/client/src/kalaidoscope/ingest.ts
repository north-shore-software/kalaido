import { err, ok, type Result } from "neverthrow";
import { activeClient, toError } from "./_active";
import { kalaidoscopeAuthHeaders } from "./client";
import type { IngestResponse } from "./types";

export type IngestPhase = "idle" | "running" | "done" | "error" | "cancelled";

export type ImportFormat = "mbox" | "text" | "zip" | "docx";

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
        skipDuplicates,
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
  file: Blob;
  filename: string;
  format?: ImportFormat;
  fragmentLimit?: number;
  extensions?: string;
  skipDuplicates?: boolean;
  organizeAfter?: boolean;
  colourId?: string;
}

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

export async function ingestFile(
  opts: FileIngestOptions,
  signal?: AbortSignal,
): Promise<Result<IngestStatus, Error>> {
  const client = activeClient();
  if (client.isErr()) return err(client.error);

  try {
    const form = new FormData();
    form.append("file", opts.file, opts.filename);
    if (opts.format) form.append("format", opts.format);
    if (opts.fragmentLimit)
      form.append("fragment_limit", String(opts.fragmentLimit));
    if (opts.extensions) form.append("extensions", opts.extensions);
    form.append("skip_duplicates", opts.skipDuplicates ? "true" : "false");
    if (opts.organizeAfter) form.append("organize_after", "true");
    if (opts.colourId) form.append("colour_id", opts.colourId);

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
