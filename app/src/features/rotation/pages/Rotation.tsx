import { useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { toast } from "sonner";
import { PageHeader, PageLayout } from "@/components/layout/page-layout";
import { Mono } from "@/components/kalaido";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { useRotationStatus } from "@/hooks/use-rotation-status";
import {
  approveProjectionCandidate,
  regenerateProjection,
} from "@/api/kalaidoscope/projections";
import { regenerateReflection } from "@/api/kalaidoscope/reflections";
import { parseProjectionOutput } from "@/hooks/use-projection-snapshot";
import { hasDelta, isActionable } from "@/api/kalaidoscope/rotation";

import {
  QNode,
  QueuedRotationRow,
} from "@/features/rotation/components/queued-rotation-row";
import { ActiveRotationCard } from "@/features/rotation/components/active-rotation-card";
import { RotationEmptyState } from "@/features/rotation/components/rotation-empty-state";
import { defineRoute } from "@/routes/route-kit";
import { rotationTransitions } from "./Rotation.transitions";

export default function Rotation() {
  const { go } = useAppNavigate();
  const { statuses, refetch } = useRotationStatus();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Projections we've already kicked a draft generation for, so the effect
  // doesn't re-fire while the pending candidate is in flight.
  const generatingFor = useRef<Set<string>>(new Set());

  const projections = useLiveCollection("projection", { filter: 'name != ""' });
  const reflections = useLiveCollection("reflection", { filter: 'name != ""' });
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
    filter: 'status="pending"',
    sort: "-created",
    fields: "id,projection_id,output",
  });
  const candidateByProjection = useMemo(() => {
    const m = new Map<string, { id: string; output: unknown }>();
    for (const s of pending.records) {
      if (!m.has(s.projection_id))
        m.set(s.projection_id, { id: s.id, output: s.output });
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
      const res = await regenerateProjection(currentId, false);
      if (res.isErr()) {
        generatingFor.current.delete(currentId);
        // 409 = the server is already generating this one (or its lens is
        // still distilling); the candidate will arrive on its own, so a
        // benign conflict must not read as a failure.
        const status = (res.error as { status?: number }).status;
        if (status !== 409) {
          toast.error("Failed to generate draft", {
            description: res.error.message,
          });
        }
      }
    })();
  }, [currentId, currentType, candidateByProjection]);

  async function advanceCurrent() {
    if (!currentId || busy) return;
    setBusy(true);

    if (currentType === "reflection") {
      const res = await regenerateReflection(currentId, true, { all: true });
      setBusy(false);
      if (res.isErr()) {
        toast.error("Failed to generate", { description: res.error.message });
        return;
      }
      refetch();
      return;
    }

    const candidate = candidateByProjection.get(currentId);
    if (!candidate) {
      setBusy(false);
      return;
    }
    const res = await approveProjectionCandidate(currentId, candidate.id);
    setBusy(false);
    if (res.isErr()) {
      toast.error("Failed to approve", { description: res.error.message });
      return;
    }
    generatingFor.current.delete(currentId);
    refetch();
  }

  function skipCurrent() {
    if (!currentId) return;
    setSkipped((prev) => new Set(prev).add(currentId));
  }

  return (
    <PageLayout>
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
                            go(rotationTransitions.tweakCandidate, {
                              params: { id: s.id, snapshotId: candidate.id },
                            });
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
    </PageLayout>
  );
}

export const rotationRoute = defineRoute({
  id: "rotation",
  path: "/rotation",
  feature: "Rotation",
  requiredScope: ["kalaidoscope"],
  transitions: rotationTransitions,
  Component: Rotation,
});
