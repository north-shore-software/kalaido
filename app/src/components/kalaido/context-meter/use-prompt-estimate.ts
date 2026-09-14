import type { UIMessage } from "ai";
import { useEffect, useMemo, useState } from "react";
import {
  type ContextItem,
  itemsToSpec,
  specKey,
} from "@/api/kalaidoscope/chat";
import { resolveContextTokens } from "@/api/kalaidoscope/context";

export interface PromptEstimate {
  /** Tokens the next turn would send; `undefined` until the first answer. */
  total?: number;
  /** The model's prompt budget; 0 or `undefined` when it reports none. */
  limit?: number;
  model?: string;
  loading: boolean;
}

const DEBOUNCE_MS = 300;

/** Text the assistant has streamed so far in the last message, if it is live. */
function streamingChars(messages: UIMessage[]): number {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return 0;
  return last.parts.reduce(
    (n, p) => n + (p.type === "text" ? (p.text?.length ?? 0) : 0),
    0,
  );
}

/** The last completed assistant turn: the estimate's cue that the transcript grew. */
function turnKey(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") return m.id;
  }
  return "";
}

/**
 * How full the conversation's context window is: the server's estimate of
 * the next turn (system prompt + context + transcript) against the model's
 * budget, re-asked whenever the context selection changes or a turn
 * completes. While a turn streams, the last answer's text is added locally
 * at the guard's chars/4 so the number moves; the server value replaces it
 * once the turn lands. A failed request keeps the last good value.
 */
export function usePromptEstimate(args: {
  conversationId: string;
  items: ContextItem[];
  messages: UIMessage[];
  streaming: boolean;
  /** Off = never asks; the panel calls this unconditionally. */
  enabled?: boolean;
}): PromptEstimate {
  const { conversationId, items, messages, streaming, enabled = true } = args;
  const [est, setEst] = useState<PromptEstimate>({ loading: true });

  const spec = useMemo(() => itemsToSpec(items), [items]);
  const key = `${conversationId}|${specKey(spec)}|${turnKey(messages)}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the identity of everything the request depends on
  useEffect(() => {
    if (!enabled || streaming) return;
    let cancelled = false;
    setEst((prev) => ({ ...prev, loading: true }));
    const timer = setTimeout(() => {
      resolveContextTokens(spec, undefined, { conversationId })
        .then((res) => {
          if (cancelled) return;
          setEst({
            total: res.totalTokens,
            limit: res.limit,
            model: res.model,
            loading: false,
          });
        })
        .catch(() => {
          if (!cancelled) setEst((prev) => ({ ...prev, loading: false }));
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, streaming, enabled]);

  const live = streaming ? Math.ceil(streamingChars(messages) / 4) : 0;
  if (live > 0 && est.total !== undefined) {
    return { ...est, total: est.total + live };
  }
  return est;
}
