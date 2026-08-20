import { Pill, SurfaceCard } from "@/components/kalaido";
import { SectionHeader } from "@/components/layout/section";
import { useLiveCollection } from "@/hooks/use-live-collection";

function pretty(body: unknown): string {
  if (body == null) return "";
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

export function MapSection() {
  const { data: maps } = useLiveCollection("kalaidoscope_map");
  const { data: runs } = useLiveCollection("map_run", { sort: "-created" });

  const map = maps?.[0];
  const run = runs?.[0];

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <SectionHeader
        title="Map"
        description="Developer view of the workspace map: the living index the mapping worker maintains from your fragments."
      />
      {run && (
        <SurfaceCard className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-row font-semibold">Latest run</span>
            <Pill tone="muted">{run.status}</Pill>
            <div className="flex-1" />
            <span className="font-mono text-mono-sm text-fg-4">
              {run.fragments_processed}/{run.fragments_total} fragments ·{" "}
              {run.chunks} chunks · {run.expansions} expansions · v
              {run.map_version_start}→v{run.map_version_end}
            </span>
          </div>
          {run.error && (
            <p className="font-mono text-mono-sm text-critical-ink">
              {run.error}
            </p>
          )}
        </SurfaceCard>
      )}
      {map ? (
        <SurfaceCard className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-row font-semibold">Current map</span>
            <Pill tone="muted">v{map.version}</Pill>
          </div>
          <pre className="overflow-auto font-mono text-mono-sm text-fg-2 whitespace-pre-wrap">
            {pretty(map.body)}
          </pre>
        </SurfaceCard>
      ) : (
        <p className="text-meta text-fg-4">
          No map yet. Import some fragments and the mapping worker will build
          one.
        </p>
      )}
    </div>
  );
}
