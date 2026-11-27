import type { DiscoverKind } from "@kalaido/client/kalaidoscope/discover";
import type { OrganizeStatus } from "@kalaido/client/kalaidoscope/organize";
import { Pill, SurfaceCard } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";
import {
  CompassIcon,
  PaletteIcon,
  PlayIcon,
  SparkleIcon,
} from "@phosphor-icons/react";

type MaybeOrganizeStatus = OrganizeStatus | null | undefined;

const DISCOVER_BUTTONS: readonly { kind: DiscoverKind; label: string }[] = [
  { kind: "colours", label: "Colours" },
  { kind: "projections", label: "Projections" },
  { kind: "reflections", label: "Reflections" },
];

function MappingStatusCard({
  organize,
  startingMap,
  onStartMap,
}: {
  organize: MaybeOrganizeStatus;
  startingMap: boolean;
  onStartMap: () => void;
}) {
  const mapState = organize?.map.state ?? "idle";
  const active = mapState === "consolidating" || mapState === "annotating";

  return (
    <SurfaceCard className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-meta font-medium text-fg-3">
          <CompassIcon className="size-4" />
          Mapping
        </span>
        <Pill tone={active ? "primary" : "muted"}>{mapState}</Pill>
      </div>
      <div className="mt-1 flex flex-col gap-1 font-mono text-mono-sm text-fg-4">
        <span>
          Annotated: {organize?.map.annotated ?? 0} / {organize?.fragments ?? 0}
        </span>
        <span>Pending annotation: {organize?.map.pendingAnnotation ?? 0}</span>
        <span>Unconsolidated: {organize?.map.unconsolidated ?? 0}</span>
      </div>
      {organize?.map.lastDrainError && (
        <p className="truncate font-mono text-mono-sm text-critical-ink">
          {organize.map.lastDrainError}
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        className="mt-auto justify-center"
        disabled={startingMap || mapState === "consolidating"}
        onClick={onStartMap}
      >
        {startingMap ? <Spinner /> : <PlayIcon className="mr-1.5 size-3.5" />}
        Run map
      </Button>
    </SurfaceCard>
  );
}

function DiscoverStatusCard({
  organize,
  startingDiscover,
  onStartDiscover,
}: {
  organize: MaybeOrganizeStatus;
  startingDiscover: DiscoverKind | null;
  onStartDiscover: (kind: DiscoverKind) => void;
}) {
  const state = organize?.discover.state ?? "idle";
  const disabled = startingDiscover !== null || state === "running";

  return (
    <SurfaceCard className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-meta font-medium text-fg-3">
          <SparkleIcon className="size-4" />
          Discover
        </span>
        <Pill tone={state === "running" ? "primary" : "muted"}>{state}</Pill>
      </div>
      <div className="mt-1 flex flex-col gap-1 font-mono text-mono-sm text-fg-4">
        <span>Running: {organize?.discover.running || "none"}</span>
        <span>Pending: {organize?.discover.pending?.join(", ") || "none"}</span>
        <span>Due: {organize?.discover.due?.join(", ") || "none"}</span>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {DISCOVER_BUTTONS.map(({ kind, label }) => (
          <Button
            key={kind}
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={disabled}
            onClick={() => onStartDiscover(kind)}
          >
            {startingDiscover === kind ? <Spinner /> : null}
            {label}
          </Button>
        ))}
      </div>
    </SurfaceCard>
  );
}

function ColourStatusCard({ organize }: { organize: MaybeOrganizeStatus }) {
  const draining = Boolean(organize?.colour?.draining);
  return (
    <SurfaceCard className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-meta font-medium text-fg-3">
          <PaletteIcon className="size-4" />
          Colour
        </span>
        <Pill tone={draining ? "primary" : "muted"}>
          {draining ? "draining" : "idle"}
        </Pill>
      </div>
      <div className="mt-1 flex flex-col gap-1 font-mono text-mono-sm text-fg-4">
        <span>Unjudged: {organize?.colour?.unjudgedFragments ?? 0}</span>
        <span>Total colours: {organize?.colour?.totalColoursCount ?? 0}</span>
        <span>Prompt colours: {organize?.colour?.promptColoursCount ?? 0}</span>
      </div>
    </SurfaceCard>
  );
}

export interface OrganizePipelinesColumnProps {
  organize: MaybeOrganizeStatus;
  startingMap: boolean;
  startingDiscover: DiscoverKind | null;
  onStartMap: () => void;
  onStartDiscover: (kind: DiscoverKind) => void;
}

export function OrganizePipelinesColumn({
  organize,
  startingMap,
  startingDiscover,
  onStartMap,
  onStartDiscover,
}: OrganizePipelinesColumnProps) {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto pr-0.5">
      <MappingStatusCard
        organize={organize}
        startingMap={startingMap}
        onStartMap={onStartMap}
      />
      <DiscoverStatusCard
        organize={organize}
        startingDiscover={startingDiscover}
        onStartDiscover={onStartDiscover}
      />
      <ColourStatusCard organize={organize} />
    </div>
  );
}
