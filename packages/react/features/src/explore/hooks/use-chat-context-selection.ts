import type { ContextItem } from "@kalaido/client/kalaidoscope/chat";
import { withContextItem } from "@kalaido/client/lib/mentions";
import {
  resolveEffectiveContext,
  useWholeScopeFits,
  type WholeScopeFit,
} from "@kalaido/components";
import { useCallback, useMemo } from "react";

/**
 * Resolves Explore chat context against the workspace's whole-scope token
 * budget (`useWholeScopeFits`): when `Full` would exceed the model budget,
 * derives `Summaries` so both `ChatPanel` and `ContextBar` share the same
 * effective selection without an upward `useEffect` mutation.
 */
export function useChatContextSelection(
  rawContext: readonly ContextItem[],
  onContextChange: (next: ContextItem[]) => void,
): {
  context: ContextItem[];
  fit: WholeScopeFit;
  setContext: (next: ContextItem[]) => void;
  mentionContext: (item: ContextItem) => void;
} {
  const fit = useWholeScopeFits();
  const context = useMemo(
    () =>
      resolveEffectiveContext(rawContext as ContextItem[], "chat", fit.fits),
    [rawContext, fit.fits],
  );
  const mentionContext = useCallback(
    (item: ContextItem) => {
      onContextChange(withContextItem(context, item));
    },
    [context, onContextChange],
  );

  return {
    context,
    fit,
    setContext: onContextChange,
    mentionContext,
  };
}
