import { parseContextSpec } from "@kalaido/client/kalaidoscope/chat";
import {
  regenerateProjection,
  restoreProjection,
  updateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import type { ProjectionResponse } from "@kalaido/client/kalaidoscope/types";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { PageHeader } from "@kalaido/components";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useContextSources } from "@kalaido/hooks/use-context-sources";
import { useFreshnessStatus } from "@kalaido/hooks/use-freshness-status";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { ConfirmDialog, EmptyState, Mono } from "@kalaido/primitives/kalaido";
import { PageBody } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
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
  onStartUpdate: (id: string, snapshotId: string) => void;
}

export function ProjectionsScreen({
  onNewProjection,
  onOpenProjection,
  onStartUpdate,
}: ProjectionsScreenProps) {
  const client = useKalaidoscopeClient();
  const [confirmUpdateTarget, setConfirmUpdateTarget] =
    useState<ProjectionResponse | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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
  // Unbound refinement sessions mark a projection as "draft in progress" as
  // soon as the authoring session begins, even before first draft text exists.
  const unboundRefinements = useLiveCollection("projection_refinement", {
    filter: 'projection_snapshot_id = "" && projection_id.deleted_at = ""',
    fields: "id,projection_id",
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

  const startUpdateWrite = useExternalWrite<
    { id: string; discardExisting: boolean },
    { readonly id: string }
  >({
    execute: ({ id, discardExisting }) =>
      regenerateProjection(id, { async: true, discardExisting }),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_refinement"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
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

  async function runStartUpdate(id: string, discardExisting: boolean) {
    setUpdatingId(id);
    const outcome = await startUpdateWrite.run({ id, discardExisting });
    setUpdatingId(null);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't update", { description: outcome.error.message });
      return;
    }
    onStartUpdate(id, outcome.id);
  }

  const draftInProgressIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of pending.records) {
      if (s.status === "pending_review") ids.add(s.projection_id);
    }
    for (const r of unboundRefinements.records) {
      if (r.projection_id) ids.add(r.projection_id);
    }
    return ids;
  }, [pending.records, unboundRefinements.records]);

  function handleRowUpdate(p: ProjectionResponse) {
    if (draftInProgressIds.has(p.id)) {
      setConfirmUpdateTarget(p);
      return;
    }
    void runStartUpdate(p.id, false);
  }

  // status='generating' rows are the server's in-flight claims, one per
  // running generation — they drive the row's "updating…" label.
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
    const hasDraftInProgress = draftInProgressIds.has(p.id);
    return (
      <ProjectionRow
        key={p.id}
        p={p}
        generatedAt={generatedAtByProjection.get(p.id)}
        hasDraftInProgress={hasDraftInProgress}
        updating={updatingId === p.id && startUpdateWrite.isPending}
        status={getProjectionStatus(statusById.get(p.id), hasDraftInProgress, {
          generating: generatingProjections.has(p.id),
        })}
        sources={resolveSources(
          parseContextSpec(p.current_context_spec),
          contextSources,
        )}
        onOpen={onOpenProjection}
        onUpdate={handleRowUpdate}
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
      <ConfirmDialog
        open={confirmUpdateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUpdateTarget(null);
        }}
        title="Discard existing draft and start fresh?"
        description="Your current in-progress draft will be discarded and a fresh update will start from your latest sources."
        confirmLabel={
          startUpdateWrite.isPending ? "Starting…" : "Discard & update"
        }
        variant="destructive"
        busy={startUpdateWrite.isPending}
        onConfirm={() => {
          if (!confirmUpdateTarget) return;
          const targetId = confirmUpdateTarget.id;
          setConfirmUpdateTarget(null);
          void runStartUpdate(targetId, true);
        }}
      />
    </>
  );
}
