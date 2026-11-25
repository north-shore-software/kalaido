import { startMap } from "@kalaido/client/kalaidoscope/map";
import { PageHeader } from "@kalaido/components";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useOrganizeStatus } from "@kalaido/hooks/use-organize-status";
import {
  EmptyState,
  Label,
  Pill,
  SurfaceCard,
} from "@kalaido/primitives/kalaido";
import { PageBody } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";
import { useExternalWrite } from "@kalaido/state/live";
import { PlayIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

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

interface MapRelationship {
  from: string;
  to: string;
  kind: string;
}

interface MapBody {
  things?: MapThing[];
  relationships?: MapRelationship[];
  narrative?: string;
}

function asMapBody(body: unknown): MapBody | null {
  if (!body || typeof body !== "object") return null;
  if (!Array.isArray((body as MapBody).things)) return null;
  return body as MapBody;
}

function MapThingsSection({ things }: { things: readonly MapThing[] }) {
  return (
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
  );
}

function MapRelationshipsSection({
  relationships,
  thingNames,
}: {
  relationships: readonly MapRelationship[];
  thingNames: ReadonlyMap<string, string>;
}) {
  if (relationships.length === 0) return null;
  return (
    <SurfaceCard className="flex flex-col gap-3">
      <Label>Relationships ({relationships.length})</Label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {relationships.map((rel) => (
          <div
            key={`${rel.from}|${rel.kind}|${rel.to}`}
            className="flex items-center gap-2 border border-line bg-surface-2 px-3 py-2 font-mono text-mono-sm"
          >
            <span className="text-fg-1 font-medium truncate">
              {thingNames.get(rel.from) ?? rel.from}
            </span>
            <Pill tone="muted">{rel.kind}</Pill>
            <span className="text-fg-4">→</span>
            <span className="text-fg-1 font-medium truncate">
              {thingNames.get(rel.to) ?? rel.to}
            </span>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

export function MapScreen() {
  const { data: maps } = useLiveCollection("kalaidoscope_map");
  const { status: organize } = useOrganizeStatus();
  const map = maps?.[0];
  const body = asMapBody(map?.body);

  const runMapWrite = useExternalWrite<void, void>({
    execute: () => startMap(),
    concurrency: "ignore",
  });

  async function handleRunMap() {
    const outcome = await runMapWrite.run();
    if (outcome.status === "error") {
      toast.error(`Map failed to start: ${outcome.error.message}`);
    }
  }

  const busy = runMapWrite.isPending || organize?.map.state === "consolidating";
  const things = [...(body?.things ?? [])].sort(
    (a, b) => (b.fragments ?? 0) - (a.fragments ?? 0),
  );
  const relationships = body?.relationships ?? [];
  const thingNames = new Map(things.map((t) => [t.id, t.name]));

  return (
    <>
      <PageHeader
        title="Map"
        crumb={["Map"]}
        actions={
          <Button size="sm" onClick={() => void handleRunMap()} disabled={busy}>
            {busy ? <Spinner /> : <PlayIcon className="mr-1.5 size-3.5" />}
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

            <MapThingsSection things={things} />
            <MapRelationshipsSection
              relationships={relationships}
              thingNames={thingNames}
            />
          </>
        ) : (
          <EmptyState centered className="py-12">
            No map document yet. Import fragments and click &ldquo;Run
            map&rdquo; to build one.
          </EmptyState>
        )}
      </PageBody>
    </>
  );
}
