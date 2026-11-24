import { subscribeInferenceRate } from "@kalaido/client/lib/inference-rate";
import { CoreProviders } from "@kalaido/components/core-providers";
import { type ReactNode, useEffect } from "react";
import { useSnapshot } from "valtio/react";
import { recordInferenceRate } from "@/state/app-state-actions";
import { appState } from "@/state/app-state";

export function AppProviders({ children }: { children: ReactNode }) {
  const {
    onboardingAcknowledged,
    errorReportingEnabled,
    usageStatisticsEnabled,
  } = useSnapshot(appState);

  useEffect(() => subscribeInferenceRate(recordInferenceRate), []);

  return (
    <CoreProviders
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
