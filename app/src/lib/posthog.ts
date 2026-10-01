import posthog from "posthog-js";

const projectToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

if (import.meta.env.DEV && import.meta.env.MODE !== "test" && !projectToken) {
  throw new Error(
    "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
  );
}

if (import.meta.env.DEV && import.meta.env.MODE !== "test" && !host) {
  throw new Error(
    "VITE_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_HOST is configured",
  );
}

export const posthogConfig =
  projectToken && host
    ? {
        apiKey: projectToken,
        options: {
          api_host: host,
          defaults: "2026-01-30" as const,
          capture_exceptions: true,
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
