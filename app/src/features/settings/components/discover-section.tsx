import { useState } from "react";
import { startDiscover } from "@/api/kalaidoscope/discover";
import { Pill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { getActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client";

type DiscoverOutput = {
  kind: string;
  id: string;
  name: string;
  status?: string;
};

export function DiscoverDebugPanel() {
  const client = getActiveKalaidoscopeClient();
  if (!client) return null;
  return (
    <KalaidoscopeClientContext.Provider value={client}>
      <DiscoverDebugContent />
    </KalaidoscopeClientContext.Provider>
  );
}

function DiscoverDebugContent() {
  const { data: runs } = useLiveCollection("discover_run", {
    sort: "-created",
  });
  const run = runs?.[0];
  const [kicking, setKicking] = useState(false);

  async function kick(kind: "projections" | "reflections") {
    setKicking(true);
    await startDiscover(kind);
    setKicking(false);
  }

  const outputs = (run?.outputs as DiscoverOutput[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => kick("projections")}
          disabled={kicking || run?.status === "running"}
        >
          Discover projections
        </Button>
        <Button
          size="sm"
          onClick={() => kick("reflections")}
          disabled={kicking || run?.status === "running"}
        >
          Discover reflections
        </Button>
      </div>
      {run && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill tone="muted">{run.kind}</Pill>
          <Pill tone="muted">{run.status}</Pill>
          <span className="font-mono text-mono-sm text-fg-4">
            map v{run.map_version} · {run.rounds} rounds · {run.fragment_reads}{" "}
            fragment reads
          </span>
        </div>
      )}
      {run?.error && (
        <p className="font-mono text-mono-sm text-critical-ink">{run.error}</p>
      )}
      {outputs.length > 0 ? (
        <div className="flex flex-col gap-1">
          {outputs.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-2 font-mono text-mono-sm text-fg-2"
            >
              <span className="text-fg-1">
                [{o.kind}] {o.name}
              </span>
              {o.status && <Pill tone="muted">{o.status}</Pill>}
            </div>
          ))}
        </div>
      ) : (
        run && (
          <p className="text-meta text-fg-4">Nothing proposed by this run.</p>
        )
      )}
      {run?.summary && (
        <p className="font-mono text-mono-sm text-fg-4">{run.summary}</p>
      )}
      {!run && (
        <p className="text-meta text-fg-4">
          No discover run yet. Build a map first, then discover.
        </p>
      )}
    </div>
  );
}
