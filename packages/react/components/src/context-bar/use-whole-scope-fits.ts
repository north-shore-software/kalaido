import {
  type TimeWindow,
  timeWindowKey,
} from "@kalaido/client/kalaidoscope/chat";
import {
  resolveContextTokens,
  type TokenResolutionResponse,
} from "@kalaido/client/kalaidoscope/context";
import { toError } from "@kalaido/client/lib/errors";
import { kalaidoscopeEndpointSource } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useLiveRead } from "@kalaido/state/live";
import { err, ok } from "neverthrow";
import { useMemo } from "react";

export interface WholeScopeFit {
  /** `undefined` while the estimate is loading or failed — never blocks. */
  fits: boolean | undefined;
  totalTokens?: number;
  limit?: number;
  model?: string;
}

/**
 * Pre-flight for the bar's Full option: whether every fragment (within the
 * window, if any) fits the chat model in full. Revalidates live when fragments
 * or workspace config change; a failed request leaves Full offered and the
 * chat's own guard to refuse.
 */
export function useWholeScopeFits(timeWindow?: TimeWindow): WholeScopeFit {
  const client = useKalaidoscopeClient();
  const windowKey = timeWindowKey(timeWindow);
  const start = timeWindow?.start;
  const end = timeWindow?.end;
  const windowId = timeWindow?.id;

  const source = useMemo(
    () =>
      kalaidoscopeEndpointSource<TokenResolutionResponse>({
        client,
        endpoint: "whole-scope-fits",
        params: [windowKey],
        watch: ["fragment", "kalaidoscope_config"],
        coalesceMs: 300,
        fetch: async () => {
          try {
            const win: TimeWindow | undefined =
              start !== undefined && end !== undefined
                ? { ...(windowId ? { id: windowId } : {}), start, end }
                : undefined;
            return ok(await resolveContextTokens({ wholeScope: "full" }, win));
          } catch (e) {
            return err(toError(e));
          }
        },
      }),
    [client, windowKey, start, end, windowId],
  );

  const read = useLiveRead(source);

  return useMemo<WholeScopeFit>(() => {
    if (!read.data || read.error) {
      return { fits: undefined };
    }
    return {
      fits: read.data.fits,
      totalTokens: read.data.totalTokens,
      limit: read.data.limit,
      model: read.data.model,
    };
  }, [read.data, read.error]);
}

/** `1.2M`, `128k`, `900` — the backend's humanTokens, for the bar's captions. */
export function humanTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
