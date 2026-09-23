import { PlayIcon } from "lucide-react";
import { useState } from "react";
import { startMap } from "@/api/kalaidoscope/map";
import { EmptyState, Label, Pill, SurfaceCard } from "@/components/kalaido";
import {
  PageBody,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { useOrganizeStatus } from "@/hooks/use-organize-status";
import { defineRoute } from "@/routes/route-kit";
import { mapTransitions } from "./Map.transitions";

interface MapThing {
  id: string;
  name: string;
  aliases?: string[];
  kind?: string;
  blurb?: string;
  fragments?: number;
  first_seen?: string;
  last_seen?: string;
}

interface MapBody {
  things?: MapThing[];
  relationships?: { from: string; to: string; kind: string }[];
  narrative?: string;
}

function asMapBody(body: unknown): MapBody | null {
  if (!body || typeof body !== "object") return null;
  if (!Array.isArray((body as MapBody).things)) return null;
  return body as MapBody;
}

export default function MapPage() {
  const { data: maps } = useLiveCollection("kalaidoscope_map");
  const { status: organize } = useOrganizeStatus();
  const map = maps?.[0];
  const body = asMapBody(map?.body);
  const [running, setRunning] = useState(false);

  async function handleRunMap() {
    setRunning(true);
    try {
      await startMap();
    } finally {
      setRunning(false);
    }
  }

  const things = [...(body?.things ?? [])].sort(
    (a, b) => (b.fragments ?? 0) - (a.fragments ?? 0),
  );
  const relationships = body?.relationships ?? [];

  return (
    <PageLayout>
      <PageHeader
        title="Map"
        crumb={["Map"]}
        actions={
          <Button
            size="sm"
            onClick={handleRunMap}
            disabled={running || organize?.map.state === "consolidating"}
          >
            {running || organize?.map.state === "consolidating" ? (
              <Spinner />
            ) : (
              <PlayIcon className="mr-1.5 size-3.5" />
            )}
            Run map
          </Button>
        }
      />
      <PageBody className="gap-5">
        {map ? (
          <>
            <SurfaceCard className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-card-title font-bold">Workspace Map</span>
                <Pill tone="muted">v{map.version}</Pill>
                <Pill
                  tone={organize?.map.state === "settled" ? "muted" : "primary"}
                >
                  {organize?.map.state ?? "ready"}
                </Pill>
                <div className="flex-1" />
                <span className="font-mono text-mono-sm text-fg-4">
                  {organize?.map.annotated ?? 0} / {organize?.fragments ?? 0}{" "}
                  fragments annotated
                </span>
                <span className="font-mono text-mono-sm text-fg-4">
                  {map.consolidated_at
                    ? `Consolidated ${map.consolidated_at}`
                    : "Not consolidated yet"}
                </span>
              </div>
            </SurfaceCard>

            {body?.narrative && (
              <SurfaceCard className="flex flex-col gap-2.5">
                <Label>Narrative</Label>
                <p className="text-body text-fg-2 whitespace-pre-wrap leading-relaxed">
                  {body.narrative}
                </p>
              </SurfaceCard>
            )}

            <SurfaceCard className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label>Discovered Things ({things.length})</Label>
                <span className="font-mono text-mono-sm text-fg-4">
                  Sorted by fragment occurrences
                </span>
              </div>
              {things.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {things.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-col gap-1 border border-line bg-surface-2 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-row font-semibold truncate text-fg-1">
                          {t.name}
                        </span>
                        <Pill tone="muted">{t.kind ?? "thing"}</Pill>
                      </div>
                      {t.aliases && t.aliases.length > 0 && (
                        <span className="text-meta text-fg-4 truncate">
                          aka {t.aliases.join(", ")}
                        </span>
                      )}
                      {t.blurb && (
                        <p className="text-meta text-fg-3 line-clamp-2 mt-1">
                          {t.blurb}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 font-mono text-mono-sm text-fg-4">
                        <span>{t.fragments ?? 0} fragments</span>
                        {t.first_seen && (
                          <span className="truncate">
                            {t.first_seen} → {t.last_seen}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState centered className="py-6">
                  No things discovered in this map yet.
                </EmptyState>
              )}
            </SurfaceCard>

            {relationships.length > 0 && (
              <SurfaceCard className="flex flex-col gap-3">
                <Label>Relationships ({relationships.length})</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {relationships.map((rel, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows are a pure derivation of the map document
                      key={`${rel.from}-${rel.to}-${i}`}
                      className="flex items-center gap-2 border border-line bg-surface-2 px-3 py-2 font-mono text-mono-sm"
                    >
                      <span className="text-fg-1 font-medium truncate">
                        {rel.from}
                      </span>
                      <Pill tone="muted">{rel.kind}</Pill>
                      <span className="text-fg-4">→</span>
                      <span className="text-fg-1 font-medium truncate">
                        {rel.to}
                      </span>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            )}
          </>
        ) : (
          <EmptyState centered className="py-12">
            No map document yet. Import fragments and click &ldquo;Run
            map&rdquo; to build one.
          </EmptyState>
        )}
      </PageBody>
    </PageLayout>
  );
}

export const mapRoute = defineRoute({
  id: "map",
  path: "/map",
  feature: "Map",
  requiredScope: ["kalaidoscope"],
  transitions: mapTransitions,
  Component: MapPage,
});
