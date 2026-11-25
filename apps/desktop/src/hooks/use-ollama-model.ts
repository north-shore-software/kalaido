import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { useCallback } from "react";
import { DesktopScopeContext } from "@/state/app-state.ts";

/**
 * App-wide selected Ollama model, persisted via the desktop root scope.
 * Defaults to the recommended model and is sent with each generation request.
 */
export function useOllamaModel() {
  const root = useScopeContext(DesktopScopeContext);
  const modelScope = useScope({
    from: root,
    state: ["ollamaModel"],
    events: ["setOllamaModel"],
  });
  const { ollamaModel } = useScopeState(modelScope);

  const setModel = useCallback(
    (model: string) => {
      void modelScope.dispatch({ type: "setOllamaModel", model });
    },
    [modelScope],
  );

  return { model: ollamaModel, setModel };
}
