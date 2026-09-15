import { PostHogProvider } from "posthog-js/react";
import { type ReactNode, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/sonner";
import { useCloudSession } from "@/hooks/use-cloud-session";
import {
  identifyUser,
  posthogConfig,
  resetPostHog,
} from "@/lib/posthog";
import { ThemeProvider } from "./theme-provider";

/** Composes every top-level integration while keeping main.tsx thin. */
export function AppProviders({ children }: { children: ReactNode }) {
  const content = (
    <ThemeProvider>
      {posthogConfig && <PostHogIdentity />}
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

function PostHogIdentity() {
  const { user } = useCloudSession();
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (identifiedUserId.current && identifiedUserId.current !== user.id) {
      resetPostHog();
    }
    identifyUser(user.id, {
      email: user.email,
      name: user.name,
    });
    identifiedUserId.current = user.id;
  }, [user]);

  return null;
}
