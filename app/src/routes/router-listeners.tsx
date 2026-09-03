import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSnapshot } from "valtio/react";
import { registerMenuNavigateListener } from "@/api/app/os-integrations.ts";
import { type AppStage, appState } from "@/hooks/use-app-state.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { pathFor } from "./registry";
import { stageEntryRoute } from "./route-kit";

/** Bridges Rust menu events (`menu:navigate`) into react-router navigation. */
export function MenuEventListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const unlistenPromise = registerMenuNavigateListener((path) =>
      navigate(path),
    );
    return () => {
      void unlistenPromise.then((result) => {
        if (result.isOk()) {
          result.value();
        }
      });
    };
  }, [navigate]);
  return null;
}

export function StateNavigationListener() {
  const navigate = useNavigate();
  const { appStage } = useSnapshot(appState);
  const handledStage = useRef<string | null>(null);

  useEffect(() => {
    // Only act on genuine stage transitions. `appStage` is reassigned to fresh
    // objects (e.g. StrictMode replays `switchLocalKalaidoscope`, writing a
    // second `kalaidoscope_open` after boot), and re-navigating to `/main` on
    // those duplicates yanks the user back from their first nav click. The key
    // carries the open kalaidoscope's id so that opening a *different* one from
    // an already-open stage still counts as a transition.
    const stageKey =
      appStage.stage === "kalaidoscope_open"
        ? `${appStage.stage}:${appStage.selectedKalaidoscopeId}`
        : appStage.stage;
    if (handledStage.current === stageKey) return;
    handledStage.current = stageKey;

    if (appStage.stage === "kalaidoscope_load_requested") {
      switchLocalKalaidoscope(appStage.loadKalaidoscopeId, {
        entry: appStage.entry,
      });
    } else if (appStage.stage !== "bootstrap") {
      // "bootstrap" is the initial stage and the initial location "/" already
      // renders Splash (a splash alias) — navigating would only push a
      // redundant history entry.
      navigate(pathFor(stageEntryRoute(appStage as AppStage)));
    }
  }, [appStage, navigate]);
  return null;
}
