import { useCallback, useEffect, useState } from "react";
import { getSetting, setSetting } from "@/api/app/settings.ts";
import { RECOMMENDED_MODEL } from "@/api/kalaidoscope/local/models";

/**
 * App-wide selected Ollama model, persisted in `kalaido-settings.json`. Defaults
 * to the recommended model and is sent with each generation request. Loads on
 * mount; changes apply to the next request that reads it.
 */
export function useOllamaModel() {
  const [model, setModelState] = useState<string>(RECOMMENDED_MODEL);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const m = await getSetting("ollamaModel");
      const saved = m.unwrapOr(undefined);
      if (!cancelled && saved) setModelState(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setModel = useCallback((m: string) => {
    setModelState(m);
    void setSetting("ollamaModel", m);
  }, []);

  return { model, setModel };
}
