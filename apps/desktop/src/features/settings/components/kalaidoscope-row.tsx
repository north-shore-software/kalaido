import { isArchived } from "@kalaido/client/lib/active-kalaidoscopes";
import { kalaidoscopeTypeLabel } from "@kalaido/client/lib/labels";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { Pill, StatusPill, SurfaceCard } from "@kalaido/primitives/kalaido";
import { LocationLabel } from "@kalaido/primitives/layout/location-label";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";
import { useExternalWrite } from "@kalaido/state/live";
import { type ReactNode, useState } from "react";
import { setKalaidoscopeArchived } from "@/lib/cloud-workspaces.ts";
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
  const [removingLocal, setRemovingLocal] = useState(false);
  const isCloud = kalaidoscope.type === "cloud";
  const archived = isArchived(kalaidoscope);

  const archiveWrite = useExternalWrite<boolean, void>({
    execute: (nextArchived) =>
      setKalaidoscopeArchived(kalaidoscope.id, nextArchived),
    concurrency: "ignore",
  });

  const removing = archiveWrite.isPending || removingLocal;

  async function handleArchive(nextArchived: boolean) {
    await archiveWrite.run(nextArchived);
    setConfirming(false);
  }

  async function handleRemoveLocal() {
    setRemovingLocal(true);
    await removeKalaidoscope(kalaidoscope.id);
    setRemovingLocal(false);
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
            onClick={() => void handleArchive(false)}
          >
            {removing ? <Spinner /> : "Unarchive"}
          </Button>
        ) : confirming ? (
          <>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() =>
                void (isCloud ? handleArchive(true) : handleRemoveLocal())
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
