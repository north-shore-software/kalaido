import {
  getPosthogConfig,
  identifyUser,
  resetPostHog,
  syncTelemetryPreferences,
} from "@kalaido/client/lib/posthog";
import { useCloudSession } from "@kalaido/hooks/use-cloud-session";
import type { Theme } from "@kalaido/primitives/lib/theme";
import { ThemeProvider } from "@kalaido/primitives/providers/theme-provider";
import { Toaster } from "@kalaido/primitives/shadcn/sonner";
import { PostHogProvider } from "posthog-js/react";
import { type ReactNode, useEffect, useRef } from "react";

export interface TelemetryPreferences {
  acknowledged: boolean;
  errorReportingEnabled: boolean;
  usageStatisticsEnabled: boolean;
}

export function CoreProviders({
  children,
  theme,
  onThemeChange,
  telemetry,
}: {
  children: ReactNode;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  telemetry?: TelemetryPreferences;
}) {
  const posthogConfig = getPosthogConfig();
  const content = (
    <ThemeProvider theme={theme} onThemeChange={onThemeChange}>
      {posthogConfig && telemetry && <PostHogTelemetrySync prefs={telemetry} />}
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

function PostHogTelemetrySync({ prefs }: { prefs: TelemetryPreferences }) {
  const { acknowledged, errorReportingEnabled, usageStatisticsEnabled } = prefs;

  useEffect(() => {
    syncTelemetryPreferences({
      acknowledged,
      errorReportingEnabled,
      usageStatisticsEnabled,
    });
  }, [acknowledged, errorReportingEnabled, usageStatisticsEnabled]);

  if (!acknowledged || (!errorReportingEnabled && !usageStatisticsEnabled)) {
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
