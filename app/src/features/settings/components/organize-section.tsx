import { useState } from "react";
import { startOrganize } from "@/api/kalaidoscope/organize";
import { Pill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { getActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client";

type NodeRef = { dimension: string; name: string };

type OrganizeEntity = {
  type: "projection" | "reflection";
  id: string;
  name: string;
  brief: string;
  wholeScope?: boolean;
  nodes?: NodeRef[];
  createdByAssignment?: { brief?: string; contextNodes?: NodeRef[] };
  generationStatus: "pending" | "done" | "error";
  generationError?: string;
};

function formatNodes(nodes: NodeRef[] | undefined): string {
  if (!nodes || nodes.length === 0) return "";
  return nodes.map((n) => `${n.dimension}: ${n.name}`).join(", ");
}

export function OrganizeDebugPanel() {
  const client = getActiveKalaidoscopeClient();
  if (!client) return null;
  return (
    <KalaidoscopeClientContext.Provider value={client}>
      <OrganizeDebugContent />
    </KalaidoscopeClientContext.Provider>
  );
}

function OrganizeDebugContent() {
  const { data: runs } = useLiveCollection("organize_run", {
    sort: "-created",
  });
  const run = runs?.[0];
  const [kicking, setKicking] = useState(false);

  async function kick() {
    setKicking(true);
    await startOrganize();
    setKicking(false);
  }

  const entities = (run?.entities as OrganizeEntity[] | undefined) ?? [];
  const warnings = (run?.warnings as string[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
      <Button
        size="sm"
        onClick={kick}
        disabled={kicking || run?.status === "running"}
      >
        Run organize
      </Button>
      {run && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill tone="muted">{run.status}</Pill>
          <span className="font-mono text-mono-sm text-fg-4">
            map v{run.map_version} · {run.explorations} explorations
          </span>
        </div>
      )}
      {run?.error && (
        <p className="font-mono text-mono-sm text-critical-ink">{run.error}</p>
      )}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          {warnings.map((w, i) => (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: warnings are an append-only log with no natural key
              key={i}
              className="font-mono text-mono-sm text-critical-ink"
            >
              {w}
            </p>
          ))}
        </div>
      )}
      {entities.length > 0 ? (
        <div className="flex flex-col gap-2">
          {entities.map((e) => (
            <div key={e.id} className="font-mono text-mono-sm text-fg-2">
              <div className="flex items-center gap-2">
                <span className="text-fg-1">
                  [{e.type}] {e.wholeScope ? "(whole scope) " : ""}
                  {e.name}
                </span>
                <Pill tone="muted">{e.generationStatus}</Pill>
              </div>
              <div className="text-fg-4">{e.brief}</div>
              {!e.wholeScope && e.nodes && (
                <div className="text-fg-4">{formatNodes(e.nodes)}</div>
              )}
              {e.createdByAssignment?.brief && (
                <div className="text-fg-4">
                  fork: {e.createdByAssignment.brief}
                </div>
              )}
              {e.generationError && (
                <div className="text-critical-ink">{e.generationError}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        run && (
          <p className="text-meta text-fg-4">
            No entities created by this run yet.
          </p>
        )
      )}
      {!run && (
        <p className="text-meta text-fg-4">
          No organize run yet. Build a map first, then run organize.
        </p>
      )}
    </div>
  );
}
