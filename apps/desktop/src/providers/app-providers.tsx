import { CoreProviders } from "@kalaido/components/core-providers";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useScope, useScopeState } from "@kalaido/state/scope";
import type { ReactNode } from "react";
import { DesktopScopeContext } from "@/state/app-state";

export function AppProviders({ children }: { children: ReactNode }) {
  const root = useScopeContext(DesktopScopeContext);
  const prefsScope = useScope({
    from: root,
    state: [
      "theme",
      "onboardingAcknowledged",
      "errorReportingEnabled",
      "usageStatisticsEnabled",
    ],
    events: ["setTheme"],
  });
  const {
    theme,
    onboardingAcknowledged,
    errorReportingEnabled,
    usageStatisticsEnabled,
  } = useScopeState(prefsScope);

  return (
    <CoreProviders
      theme={theme}
      onThemeChange={(next) => {
        void prefsScope.dispatch({ type: "setTheme", theme: next });
      }}
      telemetry={{
        acknowledged: onboardingAcknowledged,
        errorReportingEnabled,
        usageStatisticsEnabled,
      }}
    >
      {children}
    </CoreProviders>
  );
}
