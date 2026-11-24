import "./mobile.css";
import { configureClient } from "@kalaido/client/config";
import { CoreProviders } from "@kalaido/components/core-providers";
import { HostProvider } from "@kalaido/hooks/host";
import { setHost } from "@kalaido/platform";
import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./app";
import { createAppHost } from "./host";
import { installKeyboardInset } from "./keyboard-inset";
import { bootstrapCloudState } from "./state";

const host = createAppHost();
setHost(host);
installKeyboardInset();

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HostProvider host={host}>
      <CoreProviders>
        <MobileApp />
      </CoreProviders>
    </HostProvider>
  </React.StrictMode>,
);

void bootstrapCloudState();
