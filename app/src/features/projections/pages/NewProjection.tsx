import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { specToItems } from "@/api/kalaidoscope/chat";
import type { ContextSpec } from "@/api/kalaidoscope/chat";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { defineRoute } from "@/routes/route-kit";
import { newProjectionTransitions } from "./NewProjection.transitions";
import { toast } from "sonner";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  type ContextItem,
  ContextPicker,
  RefineComposer,
} from "@/components/kalaido";
import { createProjection } from "@/api/kalaidoscope/projections";
import { useRefineSession } from "@/hooks/use-refine-session";
import { ProjectionDraftEditor } from "@/features/projections/components/projection-draft-editor";
import { PlaceholderPreviewPane } from "../components/placeholder-preview-pane";

/** A readable projection name from the opening prompt (the only "name" we have). */
function deriveName(prompt: string): string {
  const t = prompt.trim().replace(/\s+/g, " ");
  if (!t) return "Untitled projection";
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/**
 * A projection that starts from something that already exists — a fragment being
 * graduated, or a projection being forked — rather than from a typed prompt.
 * Passed as router state; see {@link ProjectionSeed} consumers for who sends it.
 */
export interface ProjectionSeed {
  name: string;
  /** Text to open the draft with. Committing distils it into the lens. */
  draft: string;
  /** Inputs the new projection reads. Seeds both the picker and the chat. */
  contextSpec?: ContextSpec;
}

export default function NewProjection() {
  const { go } = useAppNavigate();

  const location = useLocation();
  // Captured once: navigating away and back must not re-run the seeding.
  const seedRef = useRef(
    ((location.state ?? {}) as { seed?: ProjectionSeed }).seed,
  );

  const [context, setContext] = useState<ContextItem[]>(
    seedRef.current?.contextSpec
      ? specToItems(seedRef.current.contextSpec)
      : [],
  );
  const [projectionId, setProjectionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);

  const session = useRefineSession({ target: "projection" });
  const started = projectionId != null && session.started;

  // The first message brings the projection into being: create the container via
  // the projection endpoint, then open a refinement session over it (no lens or
  // parent snapshot yet — both are born when this refinement is committed). Both
  // must land before the editor mounts (its ChatPanel auto-sends `firstPrompt`),
  // since /api/chat routes to the refinement handler only once the session row
  // exists for this client id.
  async function startProjection() {
    const text = input.trim();
    if (!text || creating || session.creating) return;
    setCreating(true);

    const created = await createProjection(deriveName(text));
    if (created.isErr()) {
      setCreating(false);
      toast.error("Failed to create projection", {
        description: created.error.message,
      });
      return;
    }
    const newProjectionId = created.value.projectionId;

    const ok = await session.start({ parentId: newProjectionId, prompt: text });
    setCreating(false);
    if (ok) setProjectionId(newProjectionId);
  }

  /**
   * The same flow, minus the model call: the draft is text we already have, so
   * the session opens with it in hand and the editor lands straight on a
   * reviewable draft. Approving distils it into the lens exactly as if the chat
   * had produced it.
   */
  const startFromSeed = useCallback(
    async (seed: ProjectionSeed) => {
      setCreating(true);
      const created = await createProjection(seed.name);
      if (created.isErr()) {
        setCreating(false);
        toast.error("Failed to create projection", {
          description: created.error.message,
        });
        go(newProjectionTransitions.cancel);
        return;
      }
      const newProjectionId = created.value.projectionId;

      const ok = await session.start({
        parentId: newProjectionId,
        contextSpec: seed.contextSpec,
        seedDraft: seed.draft,
      });
      setCreating(false);
      if (ok) setProjectionId(newProjectionId);
    },
    [session, go],
  );

  const seedStarted = useRef(false);
  useEffect(() => {
    const seed = seedRef.current;
    if (!seed || seedStarted.current) return;
    seedStarted.current = true;
    void startFromSeed(seed);
  }, [startFromSeed]);

  // Once the projection + refinement exist, hand off to the shared editor (chat,
  // live preview, Approve) — identical to resuming an uncommitted draft from the
  // projection detail page.
  if (started && projectionId) {
    return (
      <ProjectionDraftEditor
        session={session}
        projectionId={projectionId}
        title={seedRef.current ? seedRef.current.name : "New Projection"}
        crumb={["Projections", "New"]}
        initialContext={context}
        onCancel={() => go(newProjectionTransitions.cancel)}
        onApproveSuccess={(projId) =>
          go(newProjectionTransitions.approveSuccess, {
            params: { id: projId },
          })
        }
      />
    );
  }

  // A seeded projection never shows the composer — there is no prompt to type,
  // the draft already exists. Hold the frame while the container and session are
  // created rather than flashing a form the user can't use.
  if (seedRef.current) {
    return (
      <PageLayout>
        <PageHeader
          title={seedRef.current.name}
          crumb={["Projections", "New"]}
        />
        <PageCard>
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[13px] text-fg-2">Preparing the draft…</p>
          </div>
        </PageCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="New Projection"
        crumb={["Projections", "New"]}
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => go(newProjectionTransitions.cancel)}
          >
            Cancel
          </Button>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <ContextPicker
            entity="projection"
            value={context}
            onChange={setContext}
          />

          <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
            <RefineComposer
              title="Define via chat"
              helperText="Describe the view you want. Your first message creates the projection and starts generating a draft."
              helperTextClassName="max-w-[70%]"
              value={input}
              onChange={setInput}
              placeholder="‘A live PRD for the checkout redesign’…"
              disabled={creating}
              onSubmit={() => void startProjection()}
            />
          </div>

          <PlaceholderPreviewPane />
        </div>
      </PageCard>
    </PageLayout>
  );
}

export const newProjectionRoute = defineRoute({
  id: "new-projection",
  path: "/projections/new",
  feature: "Projections",
  requiredScope: ["kalaidoscope"],
  transitions: newProjectionTransitions,
  Component: NewProjection,
});
