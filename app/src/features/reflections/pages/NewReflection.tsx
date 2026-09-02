import { useState } from "react";
import { toast } from "sonner";
import { parseActiveWindow, type TimeWindow } from "@/api/kalaidoscope/chat";
import { createReflection } from "@/api/kalaidoscope/reflections";
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
  countGridWindows,
  FREQ,
  FREQ_DAYS,
  WIN,
  WIN_DAYS,
} from "@/features/reflections/schedule";
import { usePersistSchedule } from "@/features/reflections/use-persist-schedule";
import { useDraftName } from "@/hooks/use-draft-name";
import { useRefineSession } from "@/hooks/use-refine-session";
import { withContextItem } from "@/lib/mentions";
import { deriveName } from "@/lib/naming";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { newReflectionTransitions } from "./NewReflection.transitions";

export default function NewReflection() {
  const { go } = useAppNavigate();

  const [freq, setFreq] = useState(2);
  const [win, setWin] = useState(2);
  // "Summarize from": a calendar date (local), or empty for "from now on".
  const [fromDate, setFromDate] = useState("");
  const [context, setContext] = useState<ContextItem[]>([]);
  const [windowOverride, setWindowOverride] = useState<TimeWindow>();

  const [reflectionId, setReflectionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [creating, setCreating] = useState(false);

  const session = useRefineSession({ target: "reflection" });

  const { name, adopt, rename } = useDraftName({
    target: "reflection",
    entityId: reflectionId,
    suggestedName: session.suggestedName,
  });

  const started = reflectionId != null && session.started;
  const preview = session.preview;
  const canCommit = started && session.previewReady && !session.committing;

  // The schedule is persisted on the reflection: sent with the create call,
  // and PATCHed when the chips change after that. A start date in the past
  // is the grid origin *and* the point history is summarized from — every
  // window between it and now is generated once the lens is committed.
  const startTime = fromDate
    ? new Date(`${fromDate}T00:00:00`).toISOString()
    : undefined;
  const windowSpec = buildWindowSpec({
    cadenceDays: FREQ_DAYS[freq],
    lookbackDays: WIN_DAYS[win],
    startTime,
  });
  const historicalCount = countGridWindows(startTime, FREQ_DAYS[freq]);
  usePersistSchedule({
    reflectionId,
    spec: windowSpec,
    ready: reflectionId != null,
  });

  // The window the chat is bound to: the server seeds one (the current grid
  // window, or the trailing "as of now" window before the first grid point);
  // the selector can re-target it.
  const activeWindow =
    windowOverride ?? parseActiveWindow(session.messages) ?? undefined;

  // The first message creates the reflection (via endpoint) and opens a
  // refinement session over it — both before the chat mounts, so /api/chat
  // routes to the refinement handler. There is no lens or parent snapshot yet;
  // both are born when this refinement is committed.
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

  // "Done" commits the refinement (distilling the lens with this chat's context
  // and persisting the schedule via the carried window spec), then opens the
  // reflection. Reflections auto-approve — there is no separate review gate.
  async function finish() {
    if (!reflectionId || !canCommit) return;
    if (await session.commit(reflectionId)) {
      go(newReflectionTransitions.commitSuccess, {
        params: { id: reflectionId },
      });
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title={name ?? "New Reflection"}
        crumb={["Reflections", "New"]}
        onTitleCommit={started ? rename : undefined}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => go(newReflectionTransitions.cancel)}
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
              freq={freq}
              onFreqChange={setFreq}
              win={win}
              onWinChange={setWin}
              freqLabel="Frequency · how often it regenerates"
              winLabel="Lookback window · fragments per run"
              gap="gap-2"
              className="gap-5"
            />

            <div className="flex flex-col gap-2">
              <label
                htmlFor="reflection-from"
                className="text-meta font-medium uppercase text-fg-4"
              >
                Summarize from
              </label>
              <Input
                id="reflection-from"
                type="date"
                value={fromDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={started}
                aria-label="Summarize from date"
              />
              <p className="text-meta text-fg-4">
                {historicalCount > 0
                  ? `Will generate ${historicalCount} ${FREQ[freq].toLowerCase()} ${historicalCount === 1 ? "summary" : "summaries"} back to that date once you finish.`
                  : "Leave empty to summarize from now on."}
              </p>
            </div>

            <SchedulePill
              freq={FREQ[freq]}
              win={`${WIN[win]} · auto-approved`}
            />

            {started && reflectionId && (
              <WindowSelect
                reflectionId={reflectionId}
                active={activeWindow}
                onChange={setWindowOverride}
                refreshKey={`${windowSpec.period}|${windowSpec.duration}`}
                className="flex flex-col gap-1.5"
              />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col border-r border-line">
            {started ? (
              <RefineChatPanel
                session={session}
                title="Define the summary"
                context={context}
                onMention={(item) =>
                  setContext((prev) => withContextItem(prev, item))
                }
                onContextChange={setContext}
                entity="reflection"
                timeWindow={activeWindow}
              />
            ) : (
              <RefineComposer
                title="Define the summary"
                helperText="Describe the summary you want. Your first message creates the reflection and starts generating a draft."
                helperTextClassName="max-w-[70%]"
                value={input}
                onChange={setInput}
                placeholder="‘a tight weekly work-snippet of what shipped’…"
                disabled={creating}
                onSubmit={() => void startReflection()}
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
                  />
                }
              />
            )}
          </div>

          <LivePreviewPane
            started={started}
            preview={preview}
            phase={session.phase}
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
  transitions: newReflectionTransitions,
  Component: NewReflection,
});
