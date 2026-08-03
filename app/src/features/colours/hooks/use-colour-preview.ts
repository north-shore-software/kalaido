import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { previewColourStream } from "@/api/kalaidoscope/colours";
import type { FragmentResponse } from "@/api/kalaidoscope/types";

export const TYPE_FILTERS = [
  "all",
  "email",
  "note",
  "whatsapp",
  "sms",
] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

/** Debounced live preview of the fragments matching a draft colour's criteria.
 *
 *  `matches` holds every streamed match for the current criteria regardless of
 *  type; the type chip narrows them client-side (`fragments`) rather than
 *  re-running the LLM evaluation — the backend matches on the prompt only and
 *  ignores type. */
export function useColourPreview(criteria: string, enabled: boolean) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [matches, setMatches] = useState<FragmentResponse[]>([]);
  const [previewing, setPreviewing] = useState(false);

  // Debounced live preview while defining the criteria. Deliberately not keyed
  // on `typeFilter`: type narrowing is a client-side view of the same match
  // set, so changing the chip must not wipe results or trigger a fresh
  // evaluation.
  useEffect(() => {
    if (!enabled) return;
    const text = criteria.trim();
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
          { prompt: text },
          (frag) => {
            // A chunk can still arrive between the next run clearing the list
            // and this stream's abort landing; ignore it so it can't leak into
            // the new run's results.
            if (controller.signal.aborted) return;
            setMatches((prev) => [...prev, frag]);
          },
          controller.signal,
        );
        // The effect cleanup aborts this request when the criteria change; that
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
  }, [criteria, enabled]);

  useEffect(() => {
    if (!enabled) setTypeFilter("all");
  }, [enabled]);

  const fragments = useMemo(() => {
    if (typeFilter === "all") return matches;
    return matches.filter((f) => f.type === typeFilter);
  }, [matches, typeFilter]);

  return { matches, fragments, previewing, typeFilter, setTypeFilter };
}
