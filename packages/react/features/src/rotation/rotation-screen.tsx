import {
  approveProjectionCandidate,
  parseProjectionOutput,
  regenerateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import { regenerateReflection } from "@kalaido/client/kalaidoscope/reflections";
import { hasDelta, isActionable } from "@kalaido/client/kalaidoscope/rotation";
import { stripEditMarkers } from "@kalaido/client/lib/markdown-diff";
import { PageHeader } from "@kalaido/components";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useRotationStatus } from "@kalaido/hooks/use-rotation-status";
import { Mono } from "@kalaido/primitives/kalaido";
import { useExternalWrite } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { ActiveRotationCard } from "./components/active-rotation-card";
import { QNode, QueuedRotationRow } from "./components/queued-rotation-row";
import { RotationEmptyState } from "./components/rotation-empty-state";

interface RotationWorkflowState {
  skippedIds: string[];
}

type RotationWorkflowEvent = { readonly type: "skip"; readonly id: string };

export interface RotationScreenProps {
  onTweakCandidate: (projectionId: string, snapshotId: string) => void;
}

export function RotationScreen({ onTweakCandidate }: RotationScreenProps) {
  const client = useKalaidoscopeClient();
  const { statuses } = useRotationStatus();

  const handlers: ScopeHandlers<RotationWorkflowState, RotationWorkflowEvent> =
    {
      skip: (s, e) => {
        if (!s.skippedIds.includes(e.id)) {
          s.skippedIds = [...s.skippedIds, e.id];
        }
      },
    };
  const scope = useScope({
    initial: (): RotationWorkflowState => ({ skippedIds: [] }),
    handlers,
  });
  const { skippedIds } = useScopeState(scope);
  const skipped = useMemo(() => new Set(skippedIds), [skippedIds]);

  // Projections we've already kicked a draft generation for, so the effect
  // doesn't re-fire while the pending candidate is in flight.
  const generatingFor = useRef<Set<string>>(new Set());

  const autoGenWrite = useExternalWrite<string, { readonly id: string }>({
    execute: (id) => regenerateProjection(id, false),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  const regenReflectionWrite = useExternalWrite<
    string,
    { readonly ids: readonly string[] }
  >({
    execute: (id) => regenerateReflection(id, true, { all: true }),
    concurrency: "ignore",
    invalidates: () => [kalaidoscopeEndpointTag(client.baseURL, "reconcile")],
  });

  const approveWrite = useExternalWrite<
    { projectionId: string; snapshotId: string },
    void
  >({
    execute: ({ projectionId, snapshotId }) =>
      approveProjectionCandidate(projectionId, snapshotId),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  const busy = regenReflectionWrite.isPending || approveWrite.isPending;

  const projections = useLiveCollection("projection", {
    filter: 'name != "" && deleted_at = ""',
  });
  const reflections = useLiveCollection("reflection", {
    filter: 'name != "" && deleted_at = ""',
  });
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projections.records)
      m.set(p.id, p.name || "Untitled projection");
    for (const r of reflections.records)
      m.set(r.id, r.name || "Untitled reflection");
    return m;
  }, [projections.records, reflections.records]);

  // Latest pending candidate per projection (with its output for the card).
  // Reflections have no review gate, so only projections have candidates.
  const pending = useLiveCollection("projection_snapshot", {
    filter: 'status="pending_review" && projection_id.deleted_at = ""',
    sort: "-created",
    fields: "id,projection_id,output,output_draft",
  });
  const candidateByProjection = useMemo(() => {
    const m = new Map<string, { id: string; output: unknown }>();
    for (const s of pending.records) {
      if (!m.has(s.projection_id)) {
        const raw = (s.output_draft ?? s.output) as unknown;
        const cleaned = typeof raw === "string" ? stripEditMarkers(raw) : raw;
        m.set(s.projection_id, {
          id: s.id,
          output: cleaned,
        });
      }
    }
    return m;
  }, [pending.records]);

  // Both projections and reflections share the topo order from the server.
  const needsAction = useMemo(() => statuses.filter(hasDelta), [statuses]);

  const current = needsAction.find(
    (s) => !skipped.has(s.id) && isActionable(s),
  );
  const currentId = current?.id;
  const currentType = current?.type;

  useEffect(() => {
    if (!currentId || currentType !== "projection") return;
    if (candidateByProjection.has(currentId)) return;
    if (generatingFor.current.has(currentId)) return;
    generatingFor.current.add(currentId);
    void (async () => {
      const outcome = await autoGenWrite.run(currentId);
      if (outcome.status === "ignored") {
        generatingFor.current.delete(currentId);
        return;
      }
      if (outcome.status === "error") {
        generatingFor.current.delete(currentId);
        // 409 = the server is already generating this one (or its lens is
        // still distilling); the candidate will arrive on its own, so a
        // benign conflict must not read as a failure.
        const status = (outcome.error as { status?: number }).status;
        if (status !== 409) {
          toast.error("Failed to generate draft", {
            description: outcome.error.message,
          });
        }
      }
    })();
  }, [currentId, currentType, candidateByProjection, autoGenWrite]);

  async function advanceCurrent() {
    if (!currentId || busy) return;

    if (currentType === "reflection") {
      const outcome = await regenReflectionWrite.run(currentId);
      if (outcome.status === "error") {
        toast.error("Failed to generate", {
          description: outcome.error.message,
        });
      }
      return;
    }

    const candidate = candidateByProjection.get(currentId);
    if (!candidate) return;

    const outcome = await approveWrite.run({
      projectionId: currentId,
      snapshotId: candidate.id,
    });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to approve", { description: outcome.error.message });
      return;
    }
    generatingFor.current.delete(currentId);
  }

  function skipCurrent() {
    if (!currentId) return;
    void scope.dispatch({ type: "skip", id: currentId });
  }

  return (
    <>
      <PageHeader
        title="Rotation"
        description="bringing the whole Kalaidoscope up to date"
      />

      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="mx-auto max-w-[680px] px-7">
          {needsAction.length === 0 ? (
            <RotationEmptyState />
          ) : (
            <>
              {needsAction.map((s, i) => {
                const last = i === needsAction.length - 1;
                const isReflection = s.type === "reflection";
                const name =
                  nameById.get(s.id) ??
                  (isReflection ? "Reflection" : "Projection");
                const n = i + 1;

                if (s.id === currentId) {
                  const entropy = s.newFragmentIds?.length ?? 0;
                  const windows = [
                    ...(s.pendingWindows ?? []),
                    ...(s.staleWindows ?? []),
                  ];
                  const candidate = isReflection
                    ? undefined
                    : candidateByProjection.get(s.id);
                  const draft = candidate
                    ? parseProjectionOutput(candidate.output).content
                    : undefined;
                  return (
                    <div key={s.id} className="flex gap-4">
                      <QNode state="current" n={n} last={last} />
                      <ActiveRotationCard
                        name={name}
                        isReflection={isReflection}
                        entropy={entropy}
                        windows={windows}
                        draft={draft}
                        busy={busy}
                        hasCandidate={!!candidate}
                        onSkip={skipCurrent}
                        onTweak={() => {
                          if (candidate) {
                            onTweakCandidate(s.id, candidate.id);
                          }
                        }}
                        onApprove={() => void advanceCurrent()}
                      />
                    </div>
                  );
                }

                const blockedNames = (s.blockedBy ?? []).map(
                  (dep) => nameById.get(dep) ?? "upstream",
                );
                const dep =
                  blockedNames.length > 0
                    ? `waiting on ${blockedNames.join(", ")}`
                    : skipped.has(s.id)
                      ? "skipped"
                      : "queued";
                return (
                  <QueuedRotationRow
                    key={s.id}
                    name={name}
                    dep={dep}
                    n={n}
                    last={last}
                  />
                );
              })}
              <Mono className="ml-[42px] text-meta text-fg-4">
                only the top card is actionable · approve to advance the queue
              </Mono>
            </>
          )}
        </div>
      </div>
    </>
  );
}
