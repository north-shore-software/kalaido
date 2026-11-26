import type { FeedbackDiagnostics } from "@kalaido/platform";
import { err, ok, type Result } from "neverthrow";
import posthog from "posthog-js";
import { getPosthogConfig } from "#config";
import type { StageError } from "#lib/errors";

export { getPosthogConfig };

export function syncTelemetryPreferences(prefs: {
  acknowledged: boolean;
  errorReportingEnabled: boolean;
  usageStatisticsEnabled: boolean;
}): void {
  if (!getPosthogConfig()) return;
  if (!prefs.acknowledged) {
    posthog.stopExceptionAutocapture();
    posthog.set_config({
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
    });
    return;
  }
  if (prefs.errorReportingEnabled) {
    posthog.startExceptionAutocapture();
  } else {
    posthog.stopExceptionAutocapture();
  }
  posthog.set_config({
    autocapture: prefs.usageStatisticsEnabled,
    capture_pageview: prefs.usageStatisticsEnabled,
    capture_pageleave: prefs.usageStatisticsEnabled,
  });
}

export function identifyUser(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (!getPosthogConfig()) return;
  posthog.identify(distinctId, properties);
}

export function sendFeedback(
  message: string,
  diagnostics: FeedbackDiagnostics | null,
): Result<void, Error> {
  const config = getPosthogConfig();
  if (!config?.feedbackSurveyId || !config.feedbackQuestionId) {
    return err(new Error("Feedback isn't available in this build."));
  }
  posthog.capture(
    "survey sent",
    {
      $survey_id: config.feedbackSurveyId,
      [`$survey_response_${config.feedbackQuestionId}`]: message,
      feedback_diagnostics: diagnostics,
    },
    { send_instantly: true },
  );
  return ok(undefined);
}

export interface ErrorReportContext {
  containerId: string;
  workspaceName?: string | null;
  diagnostics: FeedbackDiagnostics | null;
}

export function sendErrorReport(
  error: StageError,
  context: ErrorReportContext,
): Result<void, Error> {
  if (!getPosthogConfig()) {
    return err(new Error("Error reporting isn't available in this build."));
  }
  const reported = new Error(error.message);
  if (error.detail) {
    reported.stack = error.detail;
  }
  posthog.captureException(reported, {
    cloud_container_id: context.containerId,
    workspace_name: context.workspaceName ?? null,
    feedback_diagnostics: context.diagnostics,
  });
  return ok(undefined);
}

export function resetPostHog(): void {
  if (!getPosthogConfig()) return;
  posthog.reset();
}
