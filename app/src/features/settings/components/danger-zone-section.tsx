import { useState } from "react";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import { resetAppSettings } from "@/api/app/settings.ts";
import { SectionHeader } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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
      <div className="flex max-w-lg flex-col gap-4 rounded-none border border-critical/40 bg-critical-wash p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-item font-medium text-fg-1">
            Reset all app settings
          </span>
          <span className="text-body-sm text-fg-3">
            Clears all saved kalaidoscopes, preferences, and app state. The app
            will restart. Kalaidoscope data directories on disk are not deleted.
          </span>
        </div>
        <div className="flex items-center justify-end gap-2">
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleReset()}
                disabled={resetting}
              >
                {resetting ? <Spinner /> : "Yes, reset"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={resetting}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirming(true)}
            >
              Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
