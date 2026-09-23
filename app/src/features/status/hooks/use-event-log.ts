import { useMemo } from "react";
import { useLiveCollection } from "@/hooks/use-live-collection";

export interface WorkspaceEvent {
  id: string;
  type: "projection_snapshot" | "reflection_snapshot" | "map_run" | "discover_run" | "ingest";
  title: string;
  subtitle?: string;
  status?: string;
  timestamp: string;
  badgeTone: "muted" | "primary" | "critical" | "stable";
}

export function useEventLog(): WorkspaceEvent[] {
  const { data: projSnapshots } = useLiveCollection("projection_snapshot", {
    sort: "-created",
  });
  const { data: projections } = useLiveCollection("projection");
  const { data: reflSnapshots } = useLiveCollection("reflection_snapshot", {
    sort: "-created",
  });
  const { data: reflections } = useLiveCollection("reflection");
  const { data: mapRuns } = useLiveCollection("map_run", {
    sort: "-created",
  });
  const { data: discoverRuns } = useLiveCollection("discover_run", {
    sort: "-created",
  });
  const { data: ingests } = useLiveCollection("ingest", {
    sort: "-created",
  });

  return useMemo(() => {
    const projMap = new Map((projections ?? []).map((p) => [p.id, p.name ?? "Untitled Projection"]));
    const reflMap = new Map((reflections ?? []).map((r) => [r.id, r.name ?? "Untitled Reflection"]));

    const events: WorkspaceEvent[] = [];

    for (const snap of (projSnapshots ?? []).slice(0, 20)) {
      const projName = snap.projection_id ? projMap.get(snap.projection_id) ?? "Projection" : "Projection";
      events.push({
        id: `proj-${snap.id}`,
        type: "projection_snapshot",
        title: `Projection Snapshot: ${projName}`,
        subtitle: snap.generated_by_model ? `Model: ${snap.generated_by_model}` : undefined,
        status: snap.status,
        timestamp: snap.created,
        badgeTone: snap.status === "approved" ? "stable" : snap.status === "generating" ? "primary" : "muted",
      });
    }

    for (const snap of (reflSnapshots ?? []).slice(0, 20)) {
      const reflName = snap.reflection_id ? reflMap.get(snap.reflection_id) ?? "Reflection" : "Reflection";
      events.push({
        id: `refl-${snap.id}`,
        type: "reflection_snapshot",
        title: `Reflection Snapshot: ${reflName}`,
        subtitle: snap.generated_by_model ? `Model: ${snap.generated_by_model}` : undefined,
        status: snap.status,
        timestamp: snap.created,
        badgeTone: snap.status === "approved" ? "stable" : snap.status === "generating" ? "primary" : "muted",
      });
    }

    for (const run of (mapRuns ?? []).slice(0, 20)) {
      events.push({
        id: `map-${run.id}`,
        type: "map_run",
        title: `Map Consolidate (v${run.version_before} → v${run.version_after})`,
        subtitle: `${run.admits ?? 0} added, ${run.merges ?? 0} folded${run.generated_by_model ? ` · ${run.generated_by_model}` : ""}`,
        status: run.status,
        timestamp: run.created,
        badgeTone: run.status === "done" ? "stable" : run.status === "running" ? "primary" : run.status === "error" ? "critical" : "muted",
      });
    }

    for (const run of (discoverRuns ?? []).slice(0, 20)) {
      events.push({
        id: `disc-${run.id}`,
        type: "discover_run",
        title: `Discover ${run.kind ?? ""}`,
        subtitle: run.summary || `${run.rounds ?? 0} rounds, ${run.fragment_reads ?? 0} reads`,
        status: run.status,
        timestamp: run.created,
        badgeTone: run.status === "done" ? "stable" : run.status === "running" ? "primary" : run.status === "error" ? "critical" : "muted",
      });
    }

    for (const ing of (ingests ?? []).slice(0, 20)) {
      events.push({
        id: `ing-${ing.id}`,
        type: "ingest",
        title: `Import: ${ing.title || ing.source || "Fragments"}`,
        subtitle: ing.error ? `Error: ${ing.error}` : undefined,
        status: ing.status,
        timestamp: ing.created,
        badgeTone: ing.status === "complete" ? "stable" : ing.status === "pending" ? "primary" : ing.status === "error" ? "critical" : "muted",
      });
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events.slice(0, 50);
  }, [projSnapshots, projections, reflSnapshots, reflections, mapRuns, discoverRuns, ingests]);
}
