import { Pill } from "@/components/kalaido";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { getActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client";

function pretty(body: unknown): string {
  if (body == null) return "";
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
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

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
      {run && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill tone="muted">{run.status}</Pill>
          <span className="font-mono text-mono-sm text-fg-4">
            {run.fragments_processed}/{run.fragments_total} fragments ·{" "}
            {run.chunks} chunks · {run.expansions} expansions · v
            {run.map_version_start}→v{run.map_version_end}
          </span>
        </div>
      )}
      {run?.error && (
        <p className="font-mono text-mono-sm text-critical-ink">{run.error}</p>
      )}
      {map ? (
        <>
          <div className="flex items-center gap-2.5">
            <span className="text-row font-semibold">Map</span>
            <Pill tone="muted">v{map.version}</Pill>
          </div>
          <pre className="max-h-96 overflow-auto font-mono text-mono-sm text-fg-2 whitespace-pre-wrap">
            {pretty(map.body)}
          </pre>
        </>
      ) : (
        <p className="text-meta text-fg-4">
          No map yet. Import some fragments and the mapping worker will build
          one.
        </p>
      )}
    </div>
  );
}
