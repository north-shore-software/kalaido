import { CloudAuthPanel } from "@/features/onboarding/components/cloud-auth-panel";

export interface SetupSignInGateProps {
  mode: "signin" | "signup";
  onModeChange: (mode: "signin" | "signup") => void;
  onAuthenticated: () => void;
}

export function SetupSignInGate({
  mode,
  onModeChange,
  onAuthenticated,
}: SetupSignInGateProps) {
  return (
    <div className="my-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sign in required
        </span>
        <h2 className="text-xl font-semibold tracking-tight">
          {mode === "signin"
            ? "Create with Kalaido Cloud"
            : "Sign up with Kalaido Cloud"}
        </h2>
        <p className="text-[15px] text-fg-3">
          Your workspace name and icon are kept.
        </p>
      </div>

      <CloudAuthPanel
        mode={mode}
        onModeChange={onModeChange}
        onAuthenticated={onAuthenticated}
      />
    </div>
  );
}
