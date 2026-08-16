import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { snapshot, subscribe } from "valtio";
import {
  appState,
  loadStoredState,
  stageError,
} from "@/hooks/use-app-state.ts";
import { AppProviders } from "@/providers/app-providers";
import { AppRouter } from "@/routes/app-router";

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </React.StrictMode>,
  );
}

subscribe(appState, () => {
  console.log("appState changed:", snapshot(appState));
});

// Render before bootstrapping, not after. The initial stage is "bootstrap",
// which stageEntryRoute maps to "splash", and MemoryRouter's initial "/" is a
// splash alias with an empty requiredScope — so the splash paints on the first
// frame and loadStoredState()'s IPC round-trip runs behind it instead of in
// front of an empty window. Splash reads no app state, so it is safe to mount
// against DEFAULT_STATE; every other route is reached only once a stage change
// navigates there.
render();

console.log("Loading stored state.");

void (async () => {
  try {
    const state = await loadStoredState();
    console.log("Stored state loaded: ", state);
    if (state) Object.assign(appState, state);
  } catch (e) {
    console.error("Failed to load stored state:", e);
    appState.appStage = { stage: "bootstrap_error", error: stageError(e) };
  }
})();
