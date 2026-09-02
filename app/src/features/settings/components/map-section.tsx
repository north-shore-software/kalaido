import { Pill } from "@/components/kalaido";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { getActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client";

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

export function MapDebugPanel() {
  const client = getActiveKalaidoscopeClient();
  if (!client) return null;
  return (
    <KalaidoscopeClientContext.Provider value={client}>
      <MapDebugContent />
    </KalaidoscopeClientContext.Provider>
  );
}

function MapDebugContent() {
  const { data: maps } = useLiveCollection("kalaidoscope_map");
  const { data: runs } = useLiveCollection("map_run", { sort: "-created" });

  const map = maps?.[0];
  const run = runs?.[0];
  const body = asMapBody(map?.body);
  const things = [...(body?.things ?? [])].sort(
    (a, b) => (b.fragments ?? 0) - (a.fragments ?? 0),
  );

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
      {map && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-row font-semibold">Map</span>
          <Pill tone="muted">v{map.version}</Pill>
          <span className="font-mono text-mono-sm text-fg-4">
            {map.annotated ?? 0}/{map.fragments ?? 0} fragments annotated
            {map.consolidated_at
              ? ` · consolidated ${map.consolidated_at}`
              : " · not consolidated yet"}
          </span>
        </div>
      )}
      {run && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill tone="muted">{run.status}</Pill>
          <span className="font-mono text-mono-sm text-fg-4">
            last consolidate: {run.pending_in} new · {run.admits} added ·{" "}
            {run.merges} folded · v{run.version_before}→v{run.version_after}
            {run.model ? ` · ${run.model}` : ""}
          </span>
        </div>
      )}
      {run?.error && (
        <p className="font-mono text-mono-sm text-critical-ink">{run.error}</p>
      )}
      {body ? (
        <>
          {body.narrative && (
            <p className="text-meta text-fg-2 whitespace-pre-wrap">
              {body.narrative}
            </p>
          )}
          <span className="font-mono text-mono-sm text-fg-4">
            {things.length} things · {body.relationships?.length ?? 0}{" "}
            relationships
          </span>
          <ul className="flex max-h-96 flex-col gap-1 overflow-auto">
            {things.map((t) => (
              <li key={t.id} className="flex flex-col">
                <span className="text-row">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-fg-4">
                    {" "}
                    · {t.kind ?? "other"} · {t.fragments ?? 0}
                    {t.first_seen ? ` · ${t.first_seen} → ${t.last_seen}` : ""}
                  </span>
                </span>
                {(t.blurb || (t.aliases?.length ?? 0) > 0) && (
                  <span className="text-meta text-fg-3">
                    {t.blurb}
                    {t.aliases?.length ? ` (aka ${t.aliases.join(", ")})` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-meta text-fg-4">
          No map yet. Import some fragments and kick the mapping worker to build
          one.
        </p>
      )}
    </div>
  );
}
