import { useEffect, useState } from "react";
import { type TimeWindow, timeWindowKey } from "@/api/kalaidoscope/chat";
import { resolveContextTokens } from "@/api/kalaidoscope/context";

export interface WholeScopeFit {
  /** `undefined` while the estimate is loading or failed — never blocks. */
  fits: boolean | undefined;
  totalTokens?: number;
  limit?: number;
  model?: string;
}

/**
 * Pre-flight for the bar's Full option: whether every fragment (within the
 * window, if any) fits the chat model in full. Asked once per mount and again
 * when the window moves; a failed request leaves Full offered and the chat's
 * own guard to refuse.
 */
export function useWholeScopeFits(timeWindow?: TimeWindow): WholeScopeFit {
  const [fit, setFit] = useState<WholeScopeFit>({ fits: undefined });
  const windowKey = timeWindowKey(timeWindow);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the window's identity is its key
  useEffect(() => {
    let cancelled = false;
    setFit({ fits: undefined });
    resolveContextTokens({ wholeScope: true }, timeWindow)
      .then((res) => {
        if (cancelled) return;
        setFit({
          fits: res.fits,
          totalTokens: res.totalTokens,
          limit: res.limit,
          model: res.model,
        });
      })
      .catch(() => {
        if (!cancelled) setFit({ fits: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [windowKey]);

  return fit;
}

/** `1.2M`, `128k`, `900` — the backend's humanTokens, for the bar's captions. */
export function humanTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
