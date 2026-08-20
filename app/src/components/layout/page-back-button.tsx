import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The pinned escape hatch on full-bleed setup and onboarding pages
 * (KalaidoscopeSetup, OnboardingLogin, CloudWorkspaces). One component so the
 * three pages share a single styling truth instead of a copied className.
 */
export function PageBackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="absolute top-9 left-12 h-7 gap-1.5 border-border/40 px-2.5 font-mono text-btn-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-surface-2 hover:text-fg-1 dark:hover:text-white"
    >
      <ArrowLeftIcon className="size-3.5" />
      Back
    </Button>
  );
}
