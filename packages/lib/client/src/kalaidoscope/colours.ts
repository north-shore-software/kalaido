import { err, ok, type Result } from "neverthrow";
import { activeClient, toError, withActiveClient } from "./_active";
import type { FragmentResponse } from "./types";

// The colour collection is write-disabled (see migrations); all mutations go
// through the dedicated /api/colours* endpoints. A colour is a prompt (judged
// by the colour role), map things (set by discover, never edited here), and
// manual positive/negative examples; membership is materialised server-side in
// `colour_fragment`, which the app reads straight from the collection.

export interface PreviewColourInput {
  prompt: string;
  positiveExamples?: string[];
  negativeExamples?: string[];
}

export interface CreateColourInput {
  name: string;
  prompt: string;
  /**
   * The live preview's matches. They were judged by this prompt already, so
   * the backend records them as prompt matches and the colour is not empty
   * on arrival; the background pass then skips them.
   */
  fragmentIds?: string[];
  positiveExamples?: string[];
  negativeExamples?: string[];
}

export interface UpdateColourInput {
  name?: string;
  /** New prompt; omit to leave it untouched. A change restarts matching. */
  prompt?: string;
  /** Fragments to pin as members (`manual_positive`). */
  positiveExamples?: string[];
  /** Fragments to exclude (`manual_negative`). */
  negativeExamples?: string[];
  /** Fragments whose manual example is withdrawn; the pair is re-derived. */
  clearExamples?: string[];
}

export interface CreateColourResult {
  colourId: string;
}
export interface UpdateColourResult {
  colourId: string;
  name: string;
  prompt: string;
}

/**
 * Preview which recent fragments the given prompt matches, streaming
 * evaluations as they finish. Bypasses client.send to process SSE chunks.
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
        prompt: input.prompt,
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
 * Create a colour. Matching against every existing fragment runs in the
 * background after this resolves; the seeded `fragmentIds` are members at once.
 */
export async function createColour(
  input: CreateColourInput,
): Promise<Result<CreateColourResult, Error>> {
  return withActiveClient((client) =>
    client.send<CreateColourResult>("/api/colours", {
      method: "POST",
      body: input,
    }),
  );
}

/** Update a colour's name, prompt and/or its manual examples. */
export async function updateColour(
  id: string,
  input: UpdateColourInput,
): Promise<Result<UpdateColourResult, Error>> {
  return withActiveClient((client) =>
    client.send<UpdateColourResult>(`/api/colours/${id}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

/** Delete a colour; its links go with it and live context specs drop its id. */
export async function deleteColour(id: string): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/colours/${id}`, { method: "DELETE" });
  });
}

/** Start matching over from scratch: prompt matches are re-judged. */
export async function rematchColour(id: string): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/colours/${id}/rematch`, { method: "POST" });
  });
}
