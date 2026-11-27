import { parseContextSpec } from "@kalaido/client/kalaidoscope/chat";
import {
  restoreProjection,
  updateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import type { ProjectionResponse } from "@kalaido/client/kalaidoscope/types";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { PageHeader } from "@kalaido/components";
import { useContextSources } from "@kalaido/hooks/use-context-sources";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useFreshnessStatus } from "@kalaido/hooks/use-freshness-status";
import { EmptyState, Mono } from "@kalaido/primitives/kalaido";
import { PageBody } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import { PlusIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  ProjectionRow,
  ProjectionTableHeader,
} from "./components/projection-row";
import { resolveSources } from "./sources";
import { getProjectionStatus } from "./status";

export interface ProjectionsScreenProps {
  onNewProjection: () => void;
  onOpenProjection: (id: string) => void;
  onReviewProjection: (id: string, snapshotId: string) => void;
}

export function ProjectionsScreen({
  onNewProjection,
  onOpenProjection,
  onReviewProjection,
}: ProjectionsScreenProps) {
  const { records: projections, isLoading } = useLiveCollection("projection", {
    filter: 'name != "" && status = "active" && deleted_at = ""',
    sort: "-updated",
  });
  const pending = useLiveCollection("projection_snapshot", {
    filter:
      '(status="pending_review" || status="generating") && projection_id.deleted_at = ""',
    sort: "-created",
    fields: "id,projection_id,status",
  });
  // Soft-deleted projections, newest deletion first. Dismissed proposals are
  // deleted the same way but are not worth restoring, so only real ones show.
  const deleted = useLiveCollection("projection", {
    filter: 'deleted_at != "" && status = "active"',
    sort: "-deleted_at",
    fields: "id,name,deleted_at",
  });

  const restoreWrite = useExternalWrite<string, void>({
    execute: (id) => restoreProjection(id),
    concurrency: "allow",
  });

  const pinWrite = useExternalWrite<ProjectionResponse, void>({
    execute: async (p) =>
      (await updateProjection(p.id, { pinned: !p.pinned })).map(
        () => undefined,
      ),
    concurrency: "allow",
  });

  async function restore(id: string) {
    const outcome = await restoreWrite.run(id);
    if (outcome.status === "error") {
      toast.error("Failed to restore", { description: outcome.error.message });
    }
  }

  async function togglePin(p: ProjectionResponse) {
    const outcome = await pinWrite.run(p);
    if (outcome.status === "error") {
      toast.error("Failed to update pin", {
        description: outcome.error.message,
      });
    }
  }

  const candidateByProjection = useMemo(() => {
    const map = new Map<string, { id: string }>();
    for (const s of pending.records) {
      if (s.status !== "pending_review") continue;
      // records are newest-first, so the first seen per projection is latest.
      if (!map.has(s.projection_id)) {
        map.set(s.projection_id, { id: s.id });
      }
    }
    return map;
  }, [pending.records]);
  // status='generating' rows are the server's in-flight claims, one per
  // running generation — they drive the card's "generating…" badge.
  const generatingProjections = useMemo(
    () =>
      new Set(
        pending.records
          .filter((s) => s.status === "generating")
          .map((s) => s.projection_id),
      ),
    [pending.records],
  );

  const { byId: statusById } = useFreshnessStatus();
  const contextSources = useContextSources();

  // When each projection's live output was generated: the newest approved
  // snapshot per projection. Records are newest-first, so the first seen wins.
  const approved = useLiveCollection("projection_snapshot", {
    filter: 'status="approved" && projection_id.deleted_at = ""',
    sort: "-generated_at,-created",
    fields: "id,projection_id,generated_at,created",
  });
  const generatedAtByProjection = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of approved.records) {
      if (!map.has(s.projection_id))
        map.set(s.projection_id, s.generated_at || s.created);
    }
    return map;
  }, [approved.records]);
  // Most recently generated first; never-generated ones sort by creation date.
  const ordered = useMemo(
    () =>
      projections
        .map((p) => ({
          p,
          at: generatedAtByProjection.get(p.id) ?? p.created,
        }))
        .sort((a, b) => b.at.localeCompare(a.at))
        .map(({ p }) => p),
    [projections, generatedAtByProjection],
  );

  function renderRow(p: ProjectionResponse) {
    const candidate = candidateByProjection.get(p.id);
    return (
      <ProjectionRow
        key={p.id}
        p={p}
        generatedAt={generatedAtByProjection.get(p.id)}
        candidateId={candidate?.id}
        status={getProjectionStatus(statusById.get(p.id), !!candidate, {
          generating: generatingProjections.has(p.id),
        })}
        sources={resolveSources(
          parseContextSpec(p.current_context_spec),
          contextSources,
        )}
        onOpen={onOpenProjection}
        onReview={onReviewProjection}
        onTogglePin={() => void togglePin(p)}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Projections"
        actions={
          <Button variant="section" onClick={onNewProjection}>
            <PlusIcon />
            New Projection
          </Button>
        }
      />
      <PageBody>
        {projections.length === 0 ? (
          <EmptyState>
            {isLoading
              ? "Loading projections…"
              : "No projections yet. Create one to get started."}
          </EmptyState>
        ) : (
          <div className="flex flex-col">
            <ProjectionTableHeader />
            {ordered.map(renderRow)}
          </div>
        )}
        {deleted.records.length > 0 && (
          <details className="mt-8 flex flex-col gap-3">
            <summary className="cursor-pointer">
              <Mono className="inline-flex items-center gap-2 text-label font-semibold uppercase text-fg-4">
                <span className="size-[5px] rounded-full bg-fg-3" />
                Recently deleted · {deleted.records.length}
              </Mono>
            </summary>
            <ul className="mt-3 flex flex-col divide-y divide-line border border-line">
              {deleted.records.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-4 px-4 py-2 text-body-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-fg-1">
                    {p.name || "Untitled projection"}
                  </span>
                  <Mono className="text-meta text-fg-4">
                    {p.deleted_at ? formatShortDateTime(p.deleted_at) : ""}
                  </Mono>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void restore(p.id)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </PageBody>
    </>
  );
}
