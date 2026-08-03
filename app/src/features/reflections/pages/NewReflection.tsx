import { useState } from "react";
import { defineRoute } from "@/routes/route-kit";
import { newReflectionTransitions } from "./NewReflection.transitions";
import { toast } from "sonner";
import { useAppNavigate } from "@/routes/use-app-navigate";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";

import {
  type ContextItem,
  ContextPicker,
  Mono,
  RefineChatPanel,
  RefineComposer,
} from "@/components/kalaido";
import { createReflection } from "@/api/kalaidoscope/reflections";
import { useRefineSession } from "@/hooks/use-refine-session";
import {
  buildWindowSpec,
  FREQ,
  FREQ_DAYS,
  WIN,
  WIN_DAYS,
} from "@/features/reflections/schedule";
import { SchedulePill } from "@/features/reflections/components/schedule-controls";
import { RefineConfigPanel } from "@/features/reflections/components/refine-config-panel";
import { LivePreviewPane } from "@/features/reflections/components/live-preview-pane";

/** A readable reflection name from the opening prompt (the only "name" we have). */
function deriveName(prompt: string): string {
  const t = prompt.trim().replace(/\s+/g, " ");
  if (!t) return "Untitled reflection";
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

export default function NewReflection() {
  const { go } = useAppNavigate();

  const [freq, setFreq] = useState(2);
  const [win, setWin] = useState(2);
  const [context, setContext] = useState<ContextItem[]>([]);

  const [reflectionId, setReflectionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);

  const session = useRefineSession({ target: "reflection" });

  const started = reflectionId != null && session.started;
  const preview = session.preview;
  const canCommit = started && preview.length > 0 && !session.committing;

  // The schedule chips become a window_spec carried through the refine chat;
  // editing them mid-chat re-emits it (ChatPanel), and commit persists it.
  const windowSpec = buildWindowSpec({
    cadenceDays: FREQ_DAYS[freq],
    lookbackDays: WIN_DAYS[win],
  });

  // The first message creates the reflection (via endpoint) and opens a
  // refinement session over it — both before the chat mounts, so /api/chat
  // routes to the refinement handler. There is no lens or parent snapshot yet;
  // both are born when this refinement is committed.
  async function startReflection() {
    const text = input.trim();
    if (!text || creating) return;
    setCreating(true);

    const created = await createReflection(deriveName(text));
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
    if (ok) setReflectionId(newReflectionId);
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
        title="New Reflection"
        crumb={["Reflections", "New"]}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => go(newReflectionTransitions.cancel)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
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
              contextSubtitle={
                <Mono className="-mt-1.5 text-[10.5px] text-fg-4">
                  colours &amp; fragment types only
                </Mono>
              }
              className="gap-5"
            >
              <ContextPicker
                initialValues={context}
                onChange={setContext}
                bare
              />
            </RefineConfigPanel>

            <SchedulePill
              freq={FREQ[freq]}
              win={`${WIN[win]} · auto-approved`}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col border-r border-line">
            {started ? (
              <RefineChatPanel
                session={session}
                title="Define the summary"
                context={context}
                windowSpec={windowSpec}
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
              />
            )}
          </div>

          <LivePreviewPane started={started} preview={preview} />
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
