import { type ReactNode, useState } from "react";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { Pill, StatusPill, SurfaceCard } from "@/components/kalaido";
import { LocationLabel } from "@/components/layout/location-label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isArchived } from "@/lib/active-kalaidoscopes.ts";
import { setKalaidoscopeArchived } from "@/lib/cloud-workspaces.ts";
import { cn } from "@/lib/css-utils";
import { kalaidoscopeTypeLabel } from "@/lib/labels";
import {
  removeKalaidoscope,
  switchLocalKalaidoscope,
} from "@/lib/local-kalaidoscope.ts";

export function KalaidoscopeRow({
  kalaidoscope,
  isActive,
  switching,
  children,
}: {
  kalaidoscope: KalaidoscopeMeta;
  isActive: boolean;
  switching?: boolean;
  children?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const isCloud = kalaidoscope.type === "cloud";
  const archived = isArchived(kalaidoscope);

  async function run(action: () => Promise<{ isErr(): boolean }>) {
    setRemoving(true);
    await action();
    setRemoving(false);
    setConfirming(false);
  }

  return (
    <SurfaceCard
      className={cn(
        "flex flex-col gap-2.5",
        isActive && "border-cyan-edge bg-cyan-veil",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "min-w-0 truncate",
            isActive ? "text-card-title font-bold" : "text-row font-semibold",
          )}
        >
          {kalaidoscope.displayName}
        </span>
        <Pill tone="muted">{kalaidoscopeTypeLabel(kalaidoscope.type)}</Pill>
        {archived && <Pill tone="muted">Archived</Pill>}
        {isActive && <StatusPill kind="cyan">active &amp; running</StatusPill>}
        <div className="flex-1" />
        {!isActive && !archived && (
          <Button
            disabled={switching || removing}
            onClick={() => void switchLocalKalaidoscope(kalaidoscope.id)}
          >
            Switch to
          </Button>
        )}
        {archived ? (
          <Button
            variant="outline"
            disabled={removing}
            onClick={() =>
              void run(() => setKalaidoscopeArchived(kalaidoscope.id, false))
            }
          >
            {removing ? <Spinner /> : "Unarchive"}
          </Button>
        ) : confirming ? (
          <>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() =>
                void run(() =>
                  isCloud
                    ? setKalaidoscopeArchived(kalaidoscope.id, true)
                    : removeKalaidoscope(kalaidoscope.id),
                )
              }
            >
              {removing ? (
                <Spinner />
              ) : isCloud ? (
                "Yes, archive"
              ) : (
                "Yes, remove"
              )}
            </Button>
            <Button
              variant="ghost"
              disabled={removing}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="destructive"
            disabled={switching || removing}
            onClick={() => setConfirming(true)}
          >
            {isCloud ? "Archive" : "Remove"}
          </Button>
        )}
      </div>
      <LocationLabel location={kalaidoscope.locator} truncate={false} />
      {archived && (
        <p className="text-meta text-muted-foreground">
          Hidden from workspace pickers. Still stored in the cloud and still on
          its plan.
        </p>
      )}
      {children}
    </SurfaceCard>
  );
}
