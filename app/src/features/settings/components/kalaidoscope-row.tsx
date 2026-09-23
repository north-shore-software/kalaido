import { type ReactNode, useState } from "react";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { Pill, StatusPill, SurfaceCard } from "@/components/kalaido";
import { LocationLabel } from "@/components/layout/location-label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
        {isActive && <StatusPill kind="cyan">active &amp; running</StatusPill>}
        <div className="flex-1" />
        {!isActive && (
          <Button
            size="sm"
            disabled={switching || removing}
            onClick={() => void switchLocalKalaidoscope(kalaidoscope.id)}
          >
            Switch to
          </Button>
        )}
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              disabled={removing}
              onClick={async () => {
                setRemoving(true);
                const res = await removeKalaidoscope(kalaidoscope.id);
                if (res.isErr()) {
                  setRemoving(false);
                  setConfirming(false);
                }
              }}
            >
              {removing ? <Spinner /> : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={removing}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={switching || removing}
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        )}
      </div>
      <LocationLabel location={kalaidoscope.locator} truncate={false} />
      {children}
    </SurfaceCard>
  );
}
