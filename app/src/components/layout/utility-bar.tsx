import { useEffect, useState } from "react";
import { useSnapshot } from "valtio/react";
import type { UnlistenFn } from "@/api/app/os-integrations.ts";
import { useTheme } from "@/providers/theme-provider";
import { appState } from "@/hooks/use-app-state.ts";
import {
  getLocalKalaidoscopeStatus,
  registerSidecarStatusChangeListener,
  type SidecarStatus,
} from "@/api/app/local-scopes";
import { phaseLabel, SidecarStatusDot } from "./sidecar-status-dot";
import { ThemeToggle } from "./theme-toggle";
import { LocationLabel } from "./location-label";

export function UtilityBar() {
  const { theme, setTheme } = useTheme();
  const { appStage, availableKalaidoscopes, latestInferenceRate } =
    useSnapshot(appState);

  // Hide the inference rate 5s after the last measurement. Valtio won't
  // re-render on elapsed time alone, so schedule a tick to force the hide.
  const [, forceTick] = useState(0);
  const rateAt = latestInferenceRate?.at;
  useEffect(() => {
    if (rateAt === undefined) return;
    const id = setTimeout(() => forceTick((n) => n + 1), 5000);
    return () => clearTimeout(id);
  }, [rateAt]);
  const showRate =
    latestInferenceRate !== undefined &&
    Date.now() - latestInferenceRate.at < 5000;

  const currentKalaidoscopeId =
    appStage.stage === "kalaidoscope_open"
      ? appStage.selectedKalaidoscopeId
      : null;
  const currentKalaidoscope =
    availableKalaidoscopes.find((k) => k.id === currentKalaidoscopeId) ?? null;
  const isLocal = currentKalaidoscope?.type === "local_file";

  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>({
    phase: "idle",
    id: null,
    message: null,
  });

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      const result =
        await registerSidecarStatusChangeListener(setSidecarStatus);
      if (result.isErr()) return;
      if (cancelled) result.value();
      else unlisten = result.value;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Status events only fire on changes, so seed the current phase on mount /
  // kalaidoscope switch.
  useEffect(() => {
    if (!currentKalaidoscopeId || !isLocal) return;
    void (async () => {
      const result = await getLocalKalaidoscopeStatus(currentKalaidoscopeId);
      if (result.isOk()) setSidecarStatus(result.value);
    })();
  }, [currentKalaidoscopeId, isLocal]);

  // For local kalaidoscopes the locator is the data directory path; for
  // cloud/local_net it's an id or URL — show it untruncated.
  const location = currentKalaidoscope ? currentKalaidoscope.locator : null;

  return (
    <div className="flex h-8 shrink-0 items-center justify-between overflow-hidden border-t border-sidebar-border bg-sidebar px-3 gap-4">
      {location ? (
        <LocationLabel
          location={location}
          title={currentKalaidoscope?.locator}
          truncate={isLocal}
        />
      ) : (
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70">
          —
        </span>
      )}

      <div className="flex items-center gap-3 shrink-0">
        {isLocal && (
          <span
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"
            title={`Database: ${sidecarStatus.message ?? phaseLabel(sidecarStatus.phase)}`}
          >
            <SidecarStatusDot phase={sidecarStatus.phase} />
            DB
          </span>
        )}

        {showRate && (
          <span className="text-[11px] text-muted-foreground/70">
            {latestInferenceRate.tokensPerSecond.toFixed(1)} tok/s
          </span>
        )}

        <ThemeToggle theme={theme} onChange={setTheme} />
      </div>
    </div>
  );
}
