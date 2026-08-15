import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Google and GitHub sign-in, shown but not yet live.
 *
 * These are deliberately inert rather than hidden: social sign-in is planned,
 * and someone who signs up with an email today should be able to see that
 * before choosing. What they must not do is silently fail — the buttons were
 * previously wired to `authClient.signIn.social` against a server with no
 * providers configured, so clicking one produced a raw backend error.
 *
 * To enable: restore an `onProvider` prop and its `onClick`, drop `disabled`
 * and the badge. The blocker is not this component — it is the callback
 * protocol, since the OAuth round-trip happens in the system browser and has to
 * get a session back into the desktop app. Options are laid out in
 * `.agents/bugs/2026-08-14-signin-signup-auth-composite.md`.
 */
export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-2 max-w-sm">
      {(["Google", "GitHub"] as const).map((provider) => (
        <Button key={provider} variant="outline" size="sm" disabled>
          Continue with {provider}
          <Badge variant="secondary" className="ml-auto">
            Coming soon
          </Badge>
        </Button>
      ))}
    </div>
  );
}
