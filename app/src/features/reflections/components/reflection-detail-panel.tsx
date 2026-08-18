import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { regenerateReflection } from "@/api/kalaidoscope/reflections";
import { parseContextSpec, specToItems } from "@/api/kalaidoscope/chat";
import { useRefineSession } from "@/hooks/use-refine-session";
import {
  buildWindowSpec,
  currentWindowSpec,
  DEFAULT_FREQ,
  DEFAULT_WIN,
  describeWindow,
  FREQ_DAYS,
  WIN_DAYS,
  windowSpecToChips,
} from "@/features/reflections/schedule";
import { SchedulePill } from "@/features/reflections/components/schedule-controls";
import {
  type ContextItem,
  ContextSummary,
  Label,
  RefineChatPanel,
  RefineComposer,
  type TimelineItem,
} from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { useLiveCollection } from "@/hooks/use-live-collection";
import {
  parseReflectionOutput,
  useReflectionSnapshot,
} from "@/hooks/use-reflection-snapshot";
import { formatShortDateTime } from "@/lib/datetime";

import { ReflectionHeader } from "./reflection-header";
import { ReflectionBody } from "./reflection-body";
import { RefineConfigPanel } from "./refine-config-panel";
import { RefreshCard } from "./refresh-card";
import { SummaryLog } from "./summary-log";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { reflectionsTransitions } from "@/features/reflections/pages/Reflections.transitions";
import { withContextItem } from "@/lib/mentions";

// A snapshot's actual resolved window ({start,end} JSON), if any.
function parseResolvedWindow(
  raw: unknown,
): { start: string; end: string } | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    if (typeof o.start === "string" && typeof o.end === "string") {
      return { start: o.start, end: o.end };
    }
  }
  return null;
}

export function ReflectionDetailPanel({
  reflectionId,
  snapshotId,
}: {
  reflectionId: string;
  snapshotId?: string;
}) {
  const { go } = useAppNavigate();
  const { state, reflection, snapshots, liveSnapshot } =
    useReflectionSnapshot(reflectionId);
  const [regenerating, setRegenerating] = useState(false);

  const readOnly = !!snapshotId;

  const historicalQuery = useLiveCollection("reflection_snapshot", {
    filter: snapshotId ? `id="${snapshotId}"` : undefined,
    enabled: readOnly,
  });
  const historical = readOnly ? historicalQuery.records[0] : undefined;
  const historicalContent = historical
    ? parseReflectionOutput(historical.output).content
    : undefined;

  // Editable context + schedule for the refine chat, seeded from the
  // reflection's current specs. Editing them re-emits a context_spec /
  // window_spec through the chat (ChatPanel), and commit persists them.
  const [context, setContext] = useState<ContextItem[]>([]);
  const [freq, setFreq] = useState(DEFAULT_FREQ);
  const [win, setWin] = useState(DEFAULT_WIN);
  const initedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!reflection || initedFor.current === reflection.id) return;
    initedFor.current = reflection.id;
    const spec = parseContextSpec(reflection.current_context_spec);
    setContext(spec ? specToItems(spec) : []);
    const chips = windowSpecToChips(
      currentWindowSpec(reflection.window_spec_versions),
    );
    setFreq(chips.freq);
    setWin(chips.win);
  }, [reflection]);
  const windowSpec = buildWindowSpec({
    cadenceDays: FREQ_DAYS[freq],
    lookbackDays: WIN_DAYS[win],
  });

  // A refinement session over the current live snapshot. Recreated whenever the
  // live snapshot changes (e.g. after a commit promotes a new one), so the next
  // refine always targets what's live. Reflections auto-approve — committing a
  // refinement goes straight to live with no review gate.
  const liveSnapId = liveSnapshot?.id;
  const session = useRefineSession({
    target: "reflection",
    onCommitted: () => toast.success("Reflection updated"),
  });
  const [sessionSnapId, setSessionSnapId] = useState<string | null>(null);
  const startingRef = useRef(false);
  useEffect(() => {
    if (readOnly || !liveSnapId) return;
    if (sessionSnapId === liveSnapId || startingRef.current) return;
    startingRef.current = true;
    void (async () => {
      try {
        const ok = await session.start({
          parentId: reflectionId,
          snapshotId: liveSnapId,
        });
        if (ok) setSessionSnapId(liveSnapId);
      } finally {
        // Always release the guard — a rejected start must not wedge session
        // creation for good.
        startingRef.current = false;
      }
    })();
  }, [readOnly, liveSnapId, sessionSnapId, reflectionId, session.start]);

  const refinedDraft = session.preview;

  async function handleRefresh() {
    if (!reflectionId || regenerating) return;
    setRegenerating(true);
    // Generate every pending window (catch-up); harmless for unscheduled
    // reflections, which just produce a single snapshot.
    const res = await regenerateReflection(reflectionId, true, { all: true });
    setRegenerating(false);
    if (res.isErr()) {
      toast.error("Failed to regenerate", { description: res.error.message });
      return;
    }
    // Reflections auto-approve, so the new snapshot(s) are already live — the
    // live view updates via the realtime subscription. Just confirm.
    const n = res.value.snapshotIds.length;
    toast.success(
      n > 1 ? `Generated ${n} snapshots` : "Reflection regenerated",
    );
  }

  async function commitRefine() {
    if (!session.started || refinedDraft.length === 0 || session.committing)
      return;
    if (await session.commit(reflectionId)) {
      // Drop the session; the live snapshot id will change via realtime and the
      // effect spins up a fresh session over the new live snapshot.
      session.reset();
      setSessionSnapId(null);
    }
  }

  const liveId = liveSnapshot?.id;
  const history = snapshots.filter((s) => s.status !== "discarded");

  const timeline: TimelineItem[] = history.map((snap, i) => {
    const version = history.length - i;
    const pending = snap.status === "pending";
    const isLive = snap.id === liveId;

    let windowLabel = "All time";
    const rw = parseResolvedWindow(snap.resolved_window);
    if (rw) {
      windowLabel = `${formatShortDateTime(rw.start)} - ${formatShortDateTime(rw.end)}`;
    }

    return {
      id: snap.id,
      label: pending ? `Pending candidate` : `Snapshot ${version}`,
      note: windowLabel,
      current: isLive,
      pending,
      active: snap.id === snapshotId,
      onClick: () => {
        if (isLive)
          go(reflectionsTransitions.selectReflection, {
            params: { id: reflectionId },
          });
        else
          go(reflectionsTransitions.viewSnapshot, {
            params: { id: reflectionId, snapshotId: snap.id },
          });
      },
    };
  });

  const schedDisplay = describeWindow(
    currentWindowSpec(reflection?.window_spec_versions),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReflectionHeader
        reflectionId={reflectionId}
        name={reflection?.name}
        schedDisplay={schedDisplay}
        readOnly={readOnly}
      />
      <div className="flex min-h-0 flex-1">
        <ReflectionBody
          readOnly={readOnly}
          historical={historical}
          historicalLoading={historicalQuery.isLoading}
          historicalContent={historicalContent}
          status={state.status}
          errorMessage={
            state.status === "error" ? state.error.message : undefined
          }
          content={state.status === "ready" ? state.output.content : undefined}
        />
        {!readOnly && (
          <div className="flex w-[340px] shrink-0 flex-col border-l border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <Label>Refine</Label>
              <Button
                size="sm"
                variant="commit"
                disabled={
                  !session.started ||
                  refinedDraft.length === 0 ||
                  session.committing
                }
                onClick={() => void commitRefine()}
              >
                {session.committing ? "Saving…" : "Commit"}
              </Button>
            </div>
            <RefineConfigPanel
              freq={freq}
              onFreqChange={setFreq}
              win={win}
              onWinChange={setWin}
              className="max-h-[40%] shrink-0 overflow-y-auto border-b border-line p-3"
            >
              <ContextSummary
                entity="reflection"
                value={context}
                onChange={setContext}
              />
            </RefineConfigPanel>
            {session.started ? (
              <RefineChatPanel
                session={session}
                context={context}
                onMention={(item) =>
                  setContext((prev) => withContextItem(prev, item))
                }
                windowSpec={windowSpec}
                placeholder="‘group by project and lead with blockers’…"
              />
            ) : (
              <RefineComposer preparing />
            )}
          </div>
        )}
        <aside className="flex w-[240px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4">
          {readOnly ? (
            <div className="rounded-lg border border-line p-3.5">
              <p className="mb-3 text-[11.5px] leading-relaxed text-fg-2">
                You’re viewing a past snapshot. It’s read-only.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() =>
                  go(reflectionsTransitions.selectReflection, {
                    params: { id: reflectionId },
                  })
                }
              >
                Back to live
              </Button>
            </div>
          ) : (
            <RefreshCard
              regenerating={regenerating}
              onRefresh={handleRefresh}
            />
          )}
          <SchedulePill
            freq={schedDisplay.freq}
            win={schedDisplay.win}
            className="px-2.5 py-2"
          />
          <SummaryLog items={timeline} />
        </aside>
      </div>
    </div>
  );
}
