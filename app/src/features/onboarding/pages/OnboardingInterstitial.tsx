import { WarningIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { setSetting } from "@/api/app/settings.ts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { completeOnboardingInterstitial } from "@/hooks/app-state-actions.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { OnboardingShell } from "../components/onboarding-shell";
import { onboardingInterstitialTransitions as transitions } from "./OnboardingInterstitial.transitions";

export default function OnboardingInterstitial() {
  const { go } = useAppNavigate();
  const errorReportingId = useId();
  const usageStatisticsId = useId();
  const [errorReportingEnabled, setErrorReportingEnabled] = useState(true);
  const [usageStatisticsEnabled, setUsageStatisticsEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    setSubmitting(true);
    await Promise.all([
      setSetting("onboardingAcknowledged", true),
      setSetting("errorReportingEnabled", errorReportingEnabled),
      setSetting("usageStatisticsEnabled", usageStatisticsEnabled),
    ]);
    completeOnboardingInterstitial({
      errorReportingEnabled,
      usageStatisticsEnabled,
    });
    go(transitions.continue);
  }

  return (
    <OnboardingShell
      title="Experimental Software"
      description="Please read before getting started with Kalaido."
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-3 rounded-none border border-drifting/40 bg-drifting-wash p-4">
          <WarningIcon className="mt-0.5 size-5 shrink-0 text-drifting" />
          <div className="flex flex-col gap-1">
            <span className="text-row font-semibold text-fg-1">
              Proceed with caution
            </span>
            <p className="text-body-sm text-fg-2">
              Kalaido is experimental software under active development. Data
              formats, features, and behaviour may change unexpectedly. Back up
              important notes and proceed with caution.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-none border border-line bg-surface-1 p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id={errorReportingId}
              checked={errorReportingEnabled}
              onCheckedChange={setErrorReportingEnabled}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <Label
                htmlFor={errorReportingId}
                className="text-row font-semibold text-fg-1"
              >
                Enable error reporting
              </Label>
              <span className="text-body-sm text-fg-3">
                Automatically send crash and error reports to help diagnose and
                fix bugs.
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3 border-t border-line pt-3">
            <Checkbox
              id={usageStatisticsId}
              checked={usageStatisticsEnabled}
              onCheckedChange={setUsageStatisticsEnabled}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <Label
                htmlFor={usageStatisticsId}
                className="text-row font-semibold text-fg-1"
              >
                Send usage statistics
              </Label>
              <span className="text-body-sm text-fg-3">
                Share anonymous usage statistics to help improve Kalaido.
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="commit"
            disabled={submitting}
            onClick={() => void handleContinue()}
          >
            Continue
          </Button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export const onboardingInterstitialRoute = defineRoute({
  id: "onboarding-interstitial",
  path: "/onboarding/welcome",
  feature: "Onboarding",
  requiredScope: [],
  transitions,
  Component: OnboardingInterstitial,
});
