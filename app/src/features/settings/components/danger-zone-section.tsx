import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SectionHeader } from "@/components/layout/section";
import { resetAppSettings } from "@/api/app/settings.ts";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";

export function DangerZoneSection() {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    setResetting(true);
    await resetAppSettings();
    reloadAppWindow();
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Danger Zone"
        description="Irreversible actions that affect all app data."
      />
      <div className="flex items-start justify-between gap-4 rounded-lg border border-destructive/40 p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Reset all app settings</span>
          <span className="text-xs text-muted-foreground">
            Clears all saved kalaidoscopes, preferences, and app state. The app
            will restart. Kalaidoscope data directories on disk are not deleted.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={resetting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleReset()}
                disabled={resetting}
              >
                {resetting ? <Spinner /> : "Yes, reset everything"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirming(true)}
            >
              Reset app settings
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
