if (import.meta.env.DEV) {
  import("react-grab");
}

import "./web.css";
import { configureClient } from "@kalaido/client/config";
import { CoreProviders } from "@kalaido/components/core-providers";
import { CloudRootScopeContext } from "@kalaido/hooks/cloud-root-scope";
import { HostProvider } from "@kalaido/hooks/host";
import { setHost, type ThemePreference } from "@kalaido/platform";
import { useScope, useScopeState } from "@kalaido/state/scope";
import React, { useCallback } from "react";
import ReactDOM from "react-dom/client";
import { WebApp } from "./app";
import { createAppHost } from "./host";
import { bootstrapCloudState, cloudScope } from "./state";

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

function WebRoot() {
  const themeScope = useScope({
    from: cloudScope,
    state: ["theme"],
    events: ["setTheme"],
  });
  const { theme } = useScopeState(themeScope);
  const handleThemeChange = useCallback(
    (next: ThemePreference) => {
      void themeScope.dispatch({ type: "setTheme", theme: next });
    },
    [themeScope],
  );

  return (
    <CloudRootScopeContext.Provider value={cloudScope}>
      <CoreProviders theme={theme} onThemeChange={handleThemeChange}>
        <WebApp />
      </CoreProviders>
    </CloudRootScopeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HostProvider host={host}>
      <WebRoot />
    </HostProvider>
  </React.StrictMode>,
);

void bootstrapCloudState();
