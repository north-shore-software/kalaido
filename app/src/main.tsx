import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { snapshot, subscribe } from "valtio";
import { appState, loadStoredState } from "@/hooks/use-app-state.ts";
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

console.log("Loading stored state.");

void (async () => {
  const state = await loadStoredState();
  console.log("Stored state loaded: ", state);
  if (state) Object.assign(appState, state);
  console.log("Calling render()");
  render();
})();
