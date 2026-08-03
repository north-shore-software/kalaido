import { useState } from "react";
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

export default function NewProjection() {
  const { go } = useAppNavigate();

  const [context, setContext] = useState<ContextItem[]>([]);
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

  // Once the projection + refinement exist, hand off to the shared editor (chat,
  // live preview, Approve) — identical to resuming an uncommitted draft from the
  // projection detail page.
  if (started && projectionId) {
    return (
      <ProjectionDraftEditor
        session={session}
        projectionId={projectionId}
        title="New Projection"
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
          <ContextPicker initialValues={context} onChange={setContext} />

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
