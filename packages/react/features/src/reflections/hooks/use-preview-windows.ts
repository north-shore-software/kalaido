import type {
  ContextSpec,
  WindowSpec,
} from "@kalaido/client/kalaidoscope/chat";
import {
  type PreviewReflectionWindow,
  previewReflectionWindows,
} from "@kalaido/client/kalaidoscope/reflections";
import { useEffect, useState } from "react";

const PREVIEW_WINDOWS_DEBOUNCE_MS = 180;

interface PreviewWindowsState {
  windows: PreviewReflectionWindow[];
  defaultWindowId: string | undefined;
  loading: boolean;
}

/**
 * Fetches candidate sample windows + matching fragment counts for the staged
 * `(windowSpec, contextSpec)` via `POST /api/reflections/preview-windows`
 * (fast DB count, zero LLM calls, zero record mutations).
 */
export function usePreviewWindows({
  windowSpec,
  contextSpec,
  reflectionId,
  enabled = true,
}: {
  windowSpec: WindowSpec;
  contextSpec: ContextSpec;
  reflectionId?: string;
  enabled?: boolean;
}): PreviewWindowsState {
  const [state, setState] = useState<PreviewWindowsState>({
    windows: [],
    defaultWindowId: undefined,
    loading: false,
  });

  const serializedPayload = JSON.stringify({
    windowSpec,
    contextSpec,
    reflectionId,
  });

  useEffect(() => {
    if (!enabled) return;
    const {
      windowSpec: ws,
      contextSpec: cs,
      reflectionId: rid,
    } = JSON.parse(serializedPayload) as {
      windowSpec: WindowSpec;
      contextSpec: ContextSpec;
      reflectionId?: string;
    };
    if (!ws.period) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setState((prev) => ({ ...prev, loading: true }));
      void previewReflectionWindows(ws, cs, rid).then((res) => {
        if (cancelled) return;
        if (res.isOk()) {
          setState({
            windows: res.value.windows,
            defaultWindowId: res.value.defaultWindowId,
            loading: false,
          });
        } else {
          setState((prev) => ({ ...prev, loading: false }));
        }
      });
    }, PREVIEW_WINDOWS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, serializedPayload]);

  return state;
}
