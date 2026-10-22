import { PostHogProvider } from "posthog-js/react";
import { type ReactNode, useEffect, useRef } from "react";
import { useSnapshot } from "valtio/react";
import { Toaster } from "@/components/ui/sonner";
import { appState } from "@/hooks/use-app-state";
import { useCloudSession } from "@/hooks/use-cloud-session";
import {
  identifyUser,
  posthogConfig,
  resetPostHog,
  syncTelemetryPreferences,
} from "@/lib/posthog";
import { ThemeProvider } from "./theme-provider";

/** Composes every top-level integration while keeping main.tsx thin. */
export function AppProviders({ children }: { children: ReactNode }) {
  const content = (
    <ThemeProvider>
      {posthogConfig && <PostHogTelemetrySync />}
      {children}
      <Toaster />
    </ThemeProvider>
  );

  if (!posthogConfig) return content;

  return (
    <PostHogProvider
      apiKey={posthogConfig.apiKey}
      options={posthogConfig.options}
    >
      {content}
    </PostHogProvider>
  );
}

function PostHogTelemetrySync() {
  const {
    onboardingAcknowledged,
    errorReportingEnabled,
    usageStatisticsEnabled,
  } = useSnapshot(appState);

  useEffect(() => {
    syncTelemetryPreferences({
      acknowledged: onboardingAcknowledged,
      errorReportingEnabled,
      usageStatisticsEnabled,
    });
  }, [onboardingAcknowledged, errorReportingEnabled, usageStatisticsEnabled]);

  if (
    !onboardingAcknowledged ||
    (!errorReportingEnabled && !usageStatisticsEnabled)
  ) {
    return null;
  }

  return <PostHogIdentity />;
}

function PostHogIdentity() {
  const { user } = useCloudSession();
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (identifiedUserId.current && identifiedUserId.current !== user.id) {
      resetPostHog();
    }
    identifyUser(user.id);

    identifiedUserId.current = user.id;
  }, [user]);

  return null;
}
