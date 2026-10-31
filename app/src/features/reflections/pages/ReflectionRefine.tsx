import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  parseActiveWindow,
  parseContextSpec,
  specToItems,
  type TimeWindow,
} from "@/api/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import {
  createReflection,
  updateReflection,
} from "@/api/kalaidoscope/reflections";
import {
  ContextBar,
  type ContextItem,
  RefineChatPanel,
  RefineComposer,
} from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LivePreviewPane } from "@/features/reflections/components/live-preview-pane";
import { RefineConfigPanel } from "@/features/reflections/components/refine-config-panel";
import { SchedulePill } from "@/features/reflections/components/schedule-controls";
import { WindowSelect } from "@/features/reflections/components/window-select";
import {
  buildWindowSpec,
  CADENCE_DAYS,
  CADENCE_WIN,
  CADENCES,
  cadenceFromSpec,
  currentWindowSpec,
  DEFAULT_CADENCE,
  dateInputToStartTime,
  toDateInputValue,
} from "@/features/reflections/schedule";
import { usePersistSchedule } from "@/features/reflections/use-persist-schedule";
import { useDraftName } from "@/hooks/use-draft-name";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { useRefineSession } from "@/hooks/use-refine-session";
import { withContextItem } from "@/lib/mentions";
import { deriveName } from "@/lib/naming";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { reflectionRefineTransitions } from "./ReflectionRefine.transitions";

/**
 * The one screen where a reflection's lens is written: creating a reflection
 * (`/reflections/new`) and refining an existing one (`/reflections/:id/refine`)
 * are the same activity. Schedule on the left, the lens chat in the middle,
 * the preview on the right with the window it is generated against — changing
 * that window regenerates the preview and nothing else. Done installs the lens
 * only: the series then regenerates its windows under it.
 */
export default function ReflectionRefine() {
  const { go } = useAppNavigate();
  // One component, two routes: `new-reflection` carries no params.
  const params = useAppParams<"new-reflection" | "refine-reflection">();
  const id = params?.id;
  const isNew = !id;
  // Captured once: navigating away and back must not re-send the message.
  const seedRef = useRef(useAppRouteState<"refine-reflection">().seed);

  const existingQuery = useLiveCollection("reflection", {
    filter: id ? `id="${id}"` : undefined,
    enabled: !isNew,
  });
  const existing = existingQuery.records[0];

  const [cadence, setCadence] = useState(DEFAULT_CADENCE);
  // "Starting from": a local calendar date, the grid origin — where the first
  // period begins and the phase it recurs on. In the past = backfill to it.
  const [fromDate, setFromDate] = useState(() => toDateInputValue(new Date()));
  const [context, setContext] = useState<ContextItem[]>([WHOLE_SCOPE_ITEM]);
  const [windowOverride, setWindowOverride] = useState<TimeWindow>();
  const [chipsSeeded, setChipsSeeded] = useState(isNew);

  const [reflectionId, setReflectionId] = useState<string | null>(id ?? null);
  const [input, setInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [creating, setCreating] = useState(false);

  const session = useRefineSession({ target: "reflection" });

  const { name, adopt, rename } = useDraftName({
    target: "reflection",
    entityId: reflectionId,
    suggestedName: session.suggestedName,
  });

  // Existing reflection: seed chips and context from the record, and open the
  // session at once — the server seeds it with the current lens, so the chat
  // and preview start from what exists. A proposal has no lens yet: its
  // opening message goes as the first turn instead, and the drafting turn
  // writes the lens.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (isNew || !existing || seededFor.current === existing.id) return;
    seededFor.current = existing.id;
    const sched = cadenceFromSpec(
      currentWindowSpec(existing.window_spec_versions),
    );
    setCadence(sched.cadence);
    setFromDate(
      sched.startTime ? toDateInputValue(new Date(sched.startTime)) : "",
    );
    const spec = parseContextSpec(existing.current_context_spec);
    setContext(spec ? specToItems(spec) : [WHOLE_SCOPE_ITEM]);
    setChipsSeeded(true);
    const seedMessage =
      existing.status === "proposed" ? seedRef.current?.message.trim() : "";
    void session.start({
      parentId: existing.id,
      prompt: seedMessage || undefined,
    });
  }, [isNew, existing, session.start]);

  const started = reflectionId != null && session.started;
  const preview = session.preview;
  const canCommit = started && session.previewReady && !session.committing;

  // An existing reflection's origin stays server-side: PATCHes omit it.
  const windowSpec = buildWindowSpec({
    cadenceDays: CADENCE_DAYS[cadence],
    lookbackDays: CADENCE_DAYS[cadence],
    startTime: isNew ? dateInputToStartTime(fromDate) : undefined,
  });
  usePersistSchedule({
    reflectionId,
    spec: windowSpec,
    ready: chipsSeeded && reflectionId != null,
  });

  // The window the preview is generated against: the server's seed (the
  // current window, or the trailing "as of now" window before the first grid
  // point) until the selector moves it.
  const activeWindow =
    windowOverride ?? parseActiveWindow(session.messages) ?? undefined;

  // New reflection: the first message creates it (with its schedule) and
  // opens the session. There is no lens yet; it is born on commit.
  async function startReflection() {
    const text = input.trim();
    if (!text || creating) return;
    setCreating(true);

    const typedName = nameInput.trim();
    const initialName = typedName || deriveName(text, "Untitled reflection");
    const created = await createReflection(initialName, windowSpec);
    if (created.isErr()) {
      setCreating(false);
      toast.error("Failed to create reflection", {
        description: created.error.message,
      });
      return;
    }
    const newReflectionId = created.value.reflectionId;

    const ok = await session.start({ parentId: newReflectionId, prompt: text });
    setCreating(false);
    if (ok) {
      adopt(initialName, !!typedName);
      setReflectionId(newReflectionId);
    }
  }

  async function finish() {
    if (!reflectionId || !canCommit) return;
    if (await session.commit(reflectionId)) {
      go(reflectionRefineTransitions.commitSuccess, {
        params: { id: reflectionId },
      });
    }
  }

  function commitTitle(next: string) {
    if (isNew) {
      rename(next);
      return;
    }
    if (!reflectionId) return;
    void updateReflection(reflectionId, { name: next }).then((res) => {
      if (res.isErr())
        toast.error("Failed to rename", { description: res.error.message });
    });
  }

  const title = isNew
    ? (name ?? "New Reflection")
    : (existing?.name ?? "Reflection");

  return (
    <PageLayout>
      <PageHeader
        title={title}
        crumb={["Reflections", isNew ? "New" : "Refine"]}
        onTitleCommit={started ? commitTitle : undefined}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() =>
                go(reflectionRefineTransitions.cancel, {
                  params: id ? { id } : {},
                })
              }
            >
              Cancel
            </Button>
            <Button
              variant="commit"
              disabled={!canCommit}
              onClick={() => void finish()}
            >
              {session.committing ? "Committing…" : "Done"}
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[322px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-line p-4">
            <RefineConfigPanel
              cadence={cadence}
              onCadenceChange={setCadence}
              fromDate={fromDate}
              onFromDateChange={setFromDate}
              fromDisabled={!isNew || started}
              fromNote={
                isNew
                  ? undefined
                  : "Fixed once created. Use Backfill on the reflection to summarize further back."
              }
            />

            <SchedulePill
              freq={CADENCES[cadence]}
              win={`${CADENCE_WIN[cadence]} · auto-approved`}
            />
          </div>

          <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
            {started ? (
              <RefineChatPanel
                session={session}
                title={isNew ? "Define the summary" : "Refine the lens"}
                context={context}
                onMention={(item) =>
                  setContext((prev) => withContextItem(prev, item))
                }
                onContextChange={setContext}
                entity="reflection"
                timeWindow={activeWindow}
                placeholder={
                  isNew
                    ? undefined
                    : "‘group by project and lead with blockers’…"
                }
              />
            ) : isNew ? (
              <RefineComposer
                title="Define the summary"
                helperText="Describe the summary you want. Your first message creates the reflection and starts generating a draft."
                helperTextClassName="max-w-[70%]"
                value={input}
                onChange={setInput}
                placeholder="‘a tight weekly work-snippet of what shipped’…"
                disabled={creating}
                onSubmit={() => void startReflection()}
                onMention={(item) =>
                  setContext((prev) => withContextItem(prev, item))
                }
                nameField={
                  <div className="shrink-0 px-4 pb-3">
                    <Input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="Name (optional — Kalaido will suggest one)"
                      aria-label="Reflection name"
                      disabled={creating}
                    />
                  </div>
                }
                beforeInput={
                  <ContextBar
                    items={context}
                    onChange={setContext}
                    entity="reflection"
                    timeWindow={activeWindow}
                  />
                }
              />
            ) : (
              <RefineComposer preparing />
            )}
          </div>

          <LivePreviewPane
            started={started}
            preview={preview}
            phase={session.phase}
            header={
              started && reflectionId ? (
                <WindowSelect
                  compact
                  reflectionId={reflectionId}
                  active={activeWindow}
                  onChange={setWindowOverride}
                  refreshKey={`${windowSpec.period}|${windowSpec.duration}`}
                />
              ) : undefined
            }
          />
        </div>
      </PageCard>
    </PageLayout>
  );
}

export const newReflectionRoute = defineRoute({
  id: "new-reflection",
  path: "/reflections/new",
  feature: "Reflections",
  requiredScope: ["kalaidoscope"],
  transitions: reflectionRefineTransitions,
  Component: ReflectionRefine,
});

export const refineReflectionRoute = defineRoute({
  id: "refine-reflection",
  path: "/reflections/:id/refine",
  feature: "Reflections",
  requiredScope: ["kalaidoscope"],
  transitions: reflectionRefineTransitions,
  Component: ReflectionRefine,
});
