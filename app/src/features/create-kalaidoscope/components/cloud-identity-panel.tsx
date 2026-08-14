import { CloudIcon } from "lucide-react";
import { SurfaceCard } from "@/components/kalaido";
import { Button } from "@/components/ui/button";

export interface CloudIdentityPanelProps {
  name?: string;
  email: string;
  onSignOut: () => void;
}

function initialsOf(name: string, email: string): string {
  return (name || email)
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Read-only account context for a cloud workspace being created, plus the one
 * escape hatch a signed-in user has here: a signed-in user with no cloud
 * workspaces cannot reach Settings at all, so "sign out somewhere else" is not
 * advice they can act on.
 *
 * This is also where the absence of a model-provider section gets explained —
 * cloud workspaces come with AI included and nothing to configure, which reads
 * as a missing feature rather than a deliberate one if the space is just empty.
 */
export function CloudIdentityPanel({
  name,
  email,
  onSignOut,
}: CloudIdentityPanelProps) {
  return (
    <SurfaceCard className="flex items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
        {initialsOf(name ?? "", email)}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">
          Signed in as <span className="font-medium">{name || email}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {name ? `${email} · ` : ""}AI is included with cloud workspaces
        </span>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onSignOut}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        Not you? Sign out
      </Button>
    </SurfaceCard>
  );
}

export interface CloudSignInNoticeProps {
  onSignIn: () => void;
}

/**
 * The signed-out counterpart of {@link CloudIdentityPanel}, filling the same
 * slot the provider fields occupy for local storage.
 *
 * Without it, picking Cloud while signed out changes nothing on screen and the
 * form silently implies no further input is needed — right up until submitting
 * replaces the whole thing with a sign-in gate. Saying so up front turns that
 * into an expected step, and the button lets anyone who would rather
 * authenticate first do it without guessing that "Create" is the way in.
 */
export function CloudSignInNotice({ onSignIn }: CloudSignInNoticeProps) {
  return (
    <SurfaceCard className="flex items-center gap-3 border-dashed">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <CloudIcon className="size-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">You&apos;re not signed in</span>
        <span className="truncate text-xs text-muted-foreground">
          Cloud workspaces need a Kalaido account
        </span>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onSignIn}
        className="shrink-0"
      >
        Sign in
      </Button>
    </SurfaceCard>
  );
}
