import { err, ok, type Result } from "neverthrow";
import posthog from "posthog-js";
import type { FeedbackDiagnostics } from "@/api/app/feedback.ts";

const projectToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;
const feedbackSurveyId = import.meta.env.VITE_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID;
const feedbackQuestionId = import.meta.env
  .VITE_PUBLIC_POSTHOG_FEEDBACK_QUESTION_ID;

export const posthogConfig =
  projectToken && host
    ? {
        apiKey: projectToken,
        options: {
          api_host: host,
          defaults: "2026-01-30" as const,
          capture_exceptions: true,
          disable_surveys: true,
          debug: import.meta.env.DEV,
        },
      }
    : null;

// For later use
// export function captureEvent(
//   eventName: string,
//   properties?: Record<string, unknown>,
// ): void {
//   if (!posthogConfig) return;
//   posthog.capture(eventName, properties);
// }

export function identifyUser(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (!posthogConfig) return;
  posthog.identify(distinctId, properties);
}

export function sendFeedback(
  message: string,
  diagnostics: FeedbackDiagnostics | null,
): Result<void, Error> {
  if (!posthogConfig || !feedbackSurveyId || !feedbackQuestionId) {
    return err(new Error("Feedback isn't available in this build."));
  }
  posthog.capture(
    "survey sent",
    {
      $survey_id: feedbackSurveyId,
      [`$survey_response_${feedbackQuestionId}`]: message,
      feedback_diagnostics: diagnostics,
    },
    { send_instantly: true },
  );
  return ok(undefined);
}

export function resetPostHog(): void {
  if (!posthogConfig) return;
  posthog.reset();
}

// For later use
// export function captureException(
//   error: unknown,
//   properties?: Record<string, unknown>,
// ): void {
//   if (!posthogConfig) return;
//   posthog.captureException(error, properties);
// }
