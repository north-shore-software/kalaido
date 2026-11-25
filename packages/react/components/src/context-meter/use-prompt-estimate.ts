import {
  type ContextItem,
  type ContextSpec,
  itemsToSpec,
  specKey,
} from "@kalaido/client/kalaidoscope/chat";
import {
  resolveContextTokens,
  type TokenResolutionResponse,
} from "@kalaido/client/kalaidoscope/context";
import { toError } from "@kalaido/client/lib/errors";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { httpLiveSource, useLiveRead } from "@kalaido/state/live";
import type { UIMessage } from "ai";
import { err, ok } from "neverthrow";
import { useEffect, useMemo, useState } from "react";

export interface PromptEstimate {
  /** Tokens the next turn would send; `undefined` until the first answer. */
  total?: number;
  /** The model's prompt budget; 0 or `undefined` when it reports none. */
  limit?: number;
  model?: string;
  /** `total` rests on the provider's real count for the last turn, not chars/4. */
  measured?: boolean;
  loading: boolean;
}

const DEBOUNCE_MS = 300;

interface SettledKey {
  readonly conversationId: string;
  readonly specKey: string;
  readonly turnKey: string;
  readonly spec: ContextSpec;
}

/**
 * Text the assistant has streamed so far in the last message, if it is live,
 * plus the output of every read it has made: in summaries mode a fragment
 * read lands in the next round's prompt just like the answer text does.
 */
function streamingChars(messages: UIMessage[]): number {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return 0;
  return last.parts.reduce((n, p) => {
    if (p.type === "text") return n + (p.text?.length ?? 0);
    if (p.type.startsWith("tool-") && "output" in p) {
      const out = (p as { output?: unknown }).output;
      return n + (typeof out === "string" ? out.length : 0);
    }
    return n;
  }, 0);
}

/** The last completed assistant turn: the estimate's cue that the transcript grew. */
function turnKey(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") return m.id;
  }
  return "";
}

function buildPromptEstimate({
  enabled,
  streaming,
  resolved,
  effective,
  currentSpecKey,
  currentTurnKey,
  isLoading,
  hasError,
  messages,
}: {
  enabled: boolean;
  streaming: boolean;
  resolved: TokenResolutionResponse | undefined;
  effective: SettledKey | null;
  currentSpecKey: string;
  currentTurnKey: string;
  isLoading: boolean;
  hasError: boolean;
  messages: UIMessage[];
}): PromptEstimate {
  const debouncing =
    enabled &&
    !streaming &&
    (effective === null ||
      effective.specKey !== currentSpecKey ||
      effective.turnKey !== currentTurnKey);

  const base: PromptEstimate = resolved
    ? {
        total: resolved.totalTokens,
        limit: resolved.limit,
        model: resolved.model,
        measured: resolved.measured,
        loading: enabled && (debouncing || isLoading),
      }
    : { loading: enabled && !hasError };

  const live = streaming ? Math.ceil(streamingChars(messages) / 4) : 0;
  if (live > 0 && base.total !== undefined) {
    return { ...base, total: base.total + live };
  }
  return base;
}

/**
 * How full the conversation's context window is: the server's estimate of
 * the next turn (system prompt + context + transcript) against the model's
 * budget, re-asked whenever the context selection changes or a turn
 * completes. While a turn streams, the pre-stream SWR key stays latched per
 * `conversationId` and the last answer's text is added locally at chars/4 so
 * the number moves; the server value replaces it once the turn lands. A failed
 * request keeps the last good value for the same conversation.
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
  const client = useKalaidoscopeClient();

  const spec = useMemo(() => itemsToSpec(items), [items]);
  const currentSpecKey = specKey(spec);
  const currentTurnKey = turnKey(messages);

  const [latched, setLatched] = useState<SettledKey | null>(null);
  const [lastGood, setLastGood] = useState<{
    conversationId: string;
    data: TokenResolutionResponse;
  } | null>(null);

  // Debounce and latch the pre-stream key. While `streaming === true` on the
  // same conversation, `latched` holds the pre-stream key so `useLiveRead`
  // retains the settled estimate for the live streaming overlay.
  useEffect(() => {
    if (!enabled || streaming) return;
    const timer = setTimeout(() => {
      setLatched({
        conversationId,
        specKey: currentSpecKey,
        turnKey: currentTurnKey,
        spec,
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    enabled,
    streaming,
    conversationId,
    currentSpecKey,
    currentTurnKey,
    spec,
  ]);

  // Reset immediately if `conversationId` changes so a previous conversation's
  // estimate never bleeds into the newly opened one.
  const effective =
    enabled && latched?.conversationId === conversationId ? latched : null;

  const source = useMemo(
    () =>
      httpLiveSource<TokenResolutionResponse>({
        key: effective
          ? [
              "pb",
              client.baseURL,
              "prompt-estimate",
              effective.conversationId,
              effective.specKey,
              effective.turnKey,
            ]
          : null,
        fetch: async () => {
          if (!effective) {
            return err(new Error("Prompt estimate key is not ready."));
          }
          try {
            return ok(
              await resolveContextTokens(effective.spec, undefined, {
                conversationId: effective.conversationId,
              }),
            );
          } catch (e) {
            return err(toError(e));
          }
        },
      }),
    [client.baseURL, effective],
  );

  const read = useLiveRead(source);

  useEffect(() => {
    if (read.data && effective) {
      setLastGood({
        conversationId: effective.conversationId,
        data: read.data,
      });
    }
  }, [read.data, effective]);

  const resolved =
    read.data ??
    (lastGood?.conversationId === conversationId ? lastGood.data : undefined);

  return buildPromptEstimate({
    enabled,
    streaming,
    resolved,
    effective,
    currentSpecKey,
    currentTurnKey,
    isLoading: read.isLoading,
    hasError: Boolean(read.error),
    messages,
  });
}
