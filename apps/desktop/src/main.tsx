if (import.meta.env.DEV) {
  import("react-grab");
}

import "./desktop.css";
import { configureClient } from "@kalaido/client/config";
import { HostProvider } from "@kalaido/hooks/host";
import { setHost } from "@kalaido/platform";
import React from "react";
import ReactDOM from "react-dom/client";
import { snapshot, subscribe } from "valtio";
import { createAppHost } from "@/host";
import { appState, bootstrapStoredState } from "@/hooks/use-app-state";
import { AppProviders } from "@/providers/app-providers";
import { AppRouter } from "@/routes/app-router";

const host = createAppHost();
setHost(host);

configureClient({
  authUrl: import.meta.env.VITE_BETTER_AUTH_URL,
  cloudPbUrl: import.meta.env.VITE_CLOUD_PB_URL,
  posthog:
    import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN &&
    import.meta.env.VITE_PUBLIC_POSTHOG_HOST
      ? {
          apiKey: import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,
          host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
          feedbackSurveyId: import.meta.env
            .VITE_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID,
          feedbackQuestionId: import.meta.env
            .VITE_PUBLIC_POSTHOG_FEEDBACK_QUESTION_ID,
          debug: import.meta.env.DEV,
        }
      : undefined,
});

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <HostProvider host={host}>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </HostProvider>
    </React.StrictMode>,
  );
}

subscribe(appState, () => {
  console.log("appState changed:", snapshot(appState));
});

render();
void bootstrapStoredState();
