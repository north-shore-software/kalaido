import { useEffect, useState } from "react";
import { toast } from "sonner";
import { previewColourStream } from "@kalaido/client/kalaidoscope/colours";
import type { FragmentResponse } from "@kalaido/client/kalaidoscope/types";

export const TYPE_FILTERS = ["all", "email", "note"] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

/** Debounced live preview of the fragments matching a draft colour's prompt.
 *
 *  `matches` holds every streamed match for the current prompt regardless of
 *  type; type-chip narrowing happens client-side inside `ColourComposerPane`
 *  rather than re-running the LLM evaluation — the backend matches on the
 *  prompt only and ignores type. */
/** The no-seed default, one identity, so it never re-runs the preview effect. */
const NO_EXAMPLES: readonly string[] = [];

export function useColourPreview(
  prompt: string,
  enabled: boolean,
  /**
   * Fragments the draft colour will pin; the preview judges with them in
   * hand. Pass a stable array — it is an effect dependency.
   */
  positiveExamples: readonly string[] = NO_EXAMPLES,
) {
  const [matches, setMatches] = useState<FragmentResponse[]>([]);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const text = prompt.trim();
    if (!text) {
      setMatches([]);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    setMatches([]);
    const controller = new AbortController();
    const handle = setTimeout(() => {
      void (async () => {
        const res = await previewColourStream(
          positiveExamples.length > 0
            ? { prompt: text, positiveExamples: [...positiveExamples] }
            : { prompt: text },
          (frag) => {
            // A chunk can still arrive between the next run clearing the list
            // and this stream's abort landing; ignore it so it can't leak into
            // the new run's results.
            if (controller.signal.aborted) return;
            setMatches((prev) => [...prev, frag]);
          },
          controller.signal,
        );
        // The effect cleanup aborts this request when the prompt changes; that
        // failure is expected, so ignore it rather than flashing it — and leave
        // `previewing` alone, since the next run owns it now.
        if (controller.signal.aborted) return;
        setPreviewing(false);
        if (res.isErr()) {
          toast.error("Preview failed", { description: res.error.message });
        }
      })();
    }, 600);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [prompt, enabled, positiveExamples]);

  return { matches, previewing };
}
