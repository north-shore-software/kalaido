import { err, ok, type Result } from "neverthrow";
import { activeClient, toError, withActiveClient } from "./_active";
import type { FragmentResponse } from "./types";

// The colour collection is write-disabled (see migrations); all mutations go
// through the dedicated /api/colours* endpoints. The API speaks `prompt`, but
// the stored column — and the rest of the frontend — call it `criteria`, so we
// map `criteria` → `prompt` only in the request bodies here.

export interface PreviewColourInput {
  /** Optional fragment-type narrowing for the preview. */
  type?: string;
  /** The natural-language criteria (sent as `prompt`). */
  prompt: string;
  positiveExamples?: string[];
  negativeExamples?: string[];
}

export interface CreateColourInput {
  name: string;
  criteria: string;
  /** Tag existing fragments in the background (else only new fragments match). */
  applyRetroactively?: boolean;
  fragmentIds?: string[];
}

export interface UpdateColourInput {
  /** New criteria text; omit to leave the definition untouched. */
  criteria?: string;
  /** Fragments to force-include as matches. */
  positiveExamples?: string[];
  /** Fragments to reject (their link becomes `manual_negative`). */
  negativeExamples?: string[];
}

export interface CreateColourResult {
  colourId: string;
}
export interface UpdateColourResult {
  colourId: string;
  prompt: string;
}

/**
 * Preview which fragments the given criteria currently matches, streaming
 * evaluations as they finish. Bypasses client.send to process NDJSON/SSE chunks.
 */
export async function previewColourStream(
  input: PreviewColourInput,
  onMatch: (fragment: FragmentResponse) => void,
  signal?: AbortSignal,
): Promise<Result<void, Error>> {
  const clientRes = activeClient();
  if (clientRes.isErr()) return err(clientRes.error);
  const client = clientRes.value;

  try {
    const url = client.buildUrl("/api/colours/preview");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(client.authStore.token
          ? { Authorization: client.authStore.token }
          : {}),
      },
      body: JSON.stringify({
        filter: { type: input.type ?? "", prompt: input.prompt },
        ...(input.positiveExamples?.length
          ? { positiveExamples: input.positiveExamples }
          : {}),
        ...(input.negativeExamples?.length
          ? { negativeExamples: input.negativeExamples }
          : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      return err(new Error(text || `HTTP error ${response.status}`));
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return err(new Error("Response body is not readable"));
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("data: ")) {
          const rawJson = trimmed.slice(6);
          try {
            const frag = JSON.parse(rawJson) as FragmentResponse;
            onMatch(frag);
          } catch (e) {
            console.error("Failed to parse SSE fragment json:", e);
          }
        }
      }
    }

    return ok(undefined);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      // Aborted stream is expected, return ok
      return ok(undefined);
    }
    return err(toError(e));
  }
}

/**
 * Create a colour. When `applyRetroactively` is set the backend enqueues a
 * background job to tag existing fragments, so membership populates
 * asynchronously after this resolves.
 */
export async function createColour(
  input: CreateColourInput,
): Promise<Result<CreateColourResult, Error>> {
  return withActiveClient((client) =>
    client.send<CreateColourResult>("/api/colours", {
      method: "POST",
      body: {
        name: input.name,
        prompt: input.criteria,
        applyRetroactively: input.applyRetroactively ?? false,
        fragmentIds: input.fragmentIds,
      },
    }),
  );
}

/**
 * Update a colour's definition and/or its manual example links. Omitting
 * `criteria` leaves the stored definition unchanged; positive/negative examples
 * are upserted as `manual_positive` / `manual_negative` links in
 * `colour_fragment`.
 */
export async function updateColour(
  id: string,
  input: UpdateColourInput,
): Promise<Result<UpdateColourResult, Error>> {
  return withActiveClient((client) =>
    client.send<UpdateColourResult>(`/api/colours/${id}`, {
      method: "PATCH",
      body: {
        ...(input.criteria !== undefined ? { prompt: input.criteria } : {}),
        ...(input.positiveExamples?.length
          ? { positiveExamples: input.positiveExamples }
          : {}),
        ...(input.negativeExamples?.length
          ? { negativeExamples: input.negativeExamples }
          : {}),
      },
    }),
  );
}
