import { isArchived } from "@kalaido/client/lib/active-kalaidoscopes";
import { kalaidoscopeTypeLabel } from "@kalaido/client/lib/labels";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { Pill, StatusPill, SurfaceCard } from "@kalaido/primitives/kalaido";
import { LocationLabel } from "@kalaido/primitives/layout/location-label";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { useExternalWrite } from "@kalaido/state/live";
import { type ReactNode, useState } from "react";
import { setKalaidoscopeArchived } from "@/lib/cloud-workspaces.ts";
import {
  removeKalaidoscope,
  switchLocalKalaidoscope,
} from "@/lib/local-kalaidoscope.ts";
import { KalaidoscopeRowActions } from "./kalaidoscope-row-actions";

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
    try {
      await removeKalaidoscope(kalaidoscope.id);
    } finally {
      setRemovingLocal(false);
      setConfirming(false);
    }
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
        <KalaidoscopeRowActions
          isActive={isActive}
          isCloud={isCloud}
          archived={archived}
          switching={switching}
          removing={removing}
          confirming={confirming}
          onSwitch={() => void switchLocalKalaidoscope(kalaidoscope.id)}
          onUnarchive={() => void handleArchive(false)}
          onConfirmRemove={() =>
            void (isCloud ? handleArchive(true) : handleRemoveLocal())
          }
          onRequestConfirm={() => setConfirming(true)}
          onCancelConfirm={() => setConfirming(false)}
        />
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
