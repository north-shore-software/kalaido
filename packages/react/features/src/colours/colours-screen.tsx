import { createColour } from "@kalaido/client/kalaidoscope/colours";
import { PageHeader } from "@kalaido/components";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { EmptyState } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ColourComposerPane } from "./components/colour-composer-pane";
import { ColourDetailPane } from "./components/colour-detail-pane";
import { ColourList } from "./components/colour-list";
import { isMember, type MemberRow } from "./fragments";
import { useColourPreview } from "./hooks/use-colour-preview";
import type { ColourSeed } from "./types";

const NO_SEED: readonly string[] = [];

interface ColoursWorkflowState {
  selectedId: string | null;
  composing: boolean;
  draftName: string;
  draftPrompt: string;
}

type ColoursWorkflowEvent =
  | { readonly type: "openComposer" }
  | { readonly type: "closeComposer" }
  | { readonly type: "selectColour"; readonly id: string | null }
  | { readonly type: "setDraftName"; readonly name: string }
  | { readonly type: "setDraftPrompt"; readonly prompt: string }
  | { readonly type: "created"; readonly id: string };

export interface ColoursScreenProps {
  seed?: ColourSeed;
}

export function ColoursScreen({ seed }: ColoursScreenProps) {
  // Captured once: a seed is a one-shot handoff, not a mode of the page.
  const [seedExamples] = useState<readonly string[]>(
    () => seed?.positiveExamples ?? NO_SEED,
  );
  const client = useKalaidoscopeClient();

  const scope = useScope<ColoursWorkflowState, ColoursWorkflowEvent>({
    initial: () => ({
      selectedId: null,
      composing: seedExamples.length > 0,
      draftName: "",
      draftPrompt: "",
    }),
    handlers: {
      openComposer: (s) => {
        s.composing = true;
        s.draftName = "";
        s.draftPrompt = "";
      },
      closeComposer: (s) => {
        s.composing = false;
      },
      selectColour: (s, e) => {
        s.composing = false;
        s.selectedId = e.id;
      },
      setDraftName: (s, e) => {
        s.draftName = e.name;
      },
      setDraftPrompt: (s, e) => {
        s.draftPrompt = e.prompt;
      },
      created: (s, e) => {
        s.composing = false;
        s.selectedId = e.id;
      },
    },
  });

  const { selectedId, composing, draftName, draftPrompt } =
    useScopeState(scope);

  const colours = useLiveCollection("colour", {
    sort: "-created",
    fields: "id,name,prompt,swatch",
  });

  const allLinks = useLiveCollection("colour_fragment", {
    fields: "colour_id,match_type",
  });
  const countByColour = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allLinks.records as unknown as MemberRow[]) {
      if (!isMember(r.match_type)) continue;
      m.set(r.colour_id, (m.get(r.colour_id) ?? 0) + 1);
    }
    return m;
  }, [allLinks.records]);

  const memberQuery = useLiveCollection("colour_fragment", {
    filter: selectedId ? `colour_id="${selectedId}"` : "",
    expand: "fragment_id",
    fields: "id,colour_id,fragment_id,match_type,expand",
    sort: "-created",
    enabled: !!selectedId,
  });
  const members = memberQuery.records as unknown as MemberRow[];

  const selected = useMemo(
    () => colours.records.find((c) => c.id === selectedId) ?? null,
    [colours.records, selectedId],
  );

  const preview = useColourPreview(draftPrompt, composing, seedExamples);

  const createWrite = useExternalWrite<
    Parameters<typeof createColour>[0],
    { readonly id: string }
  >({
    execute: (input) => createColour(input),
    concurrency: "ignore",
    invalidates: () => [kalaidoscopeCollectionTag(client.baseURL, "colour")],
  });

  async function saveNew() {
    const name = draftName.trim();
    const prompt = draftPrompt.trim();
    if (!name || !prompt) return;
    const outcome = await createWrite.run({
      name,
      prompt,
      // Seed every match, not the type-filtered view — the colour matches on the
      // prompt regardless of type; the chip is only a preview convenience.
      fragmentIds: preview.matches.map((f) => f.id),
      ...(seedExamples.length > 0
        ? { positiveExamples: [...seedExamples] }
        : {}),
    });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to create colour", {
        description: outcome.error.message,
      });
      return;
    }
    void scope.dispatch({ type: "created", id: outcome.id });
  }

  return (
    <>
      <PageHeader
        title="Colours"
        actions={
          composing ? (
            <>
              <Button
                variant="ghost"
                onClick={() => void scope.dispatch({ type: "closeComposer" })}
              >
                Cancel
              </Button>
              <Button
                variant="commit"
                disabled={
                  !draftName.trim() ||
                  !draftPrompt.trim() ||
                  createWrite.isPending
                }
                onClick={() => void saveNew()}
              >
                {createWrite.isPending ? "Creating…" : "Create colour"}
              </Button>
            </>
          ) : (
            <Button
              variant="section"
              onClick={() => void scope.dispatch({ type: "openComposer" })}
            >
              <PlusIcon />
              New Colour
            </Button>
          )
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <ColourList
            colours={colours.records}
            isLoading={colours.isLoading}
            countByColour={countByColour}
            selectedId={composing ? null : selectedId}
            onSelect={(id) => void scope.dispatch({ type: "selectColour", id })}
          />
          {composing ? (
            <ColourComposerPane
              name={draftName}
              prompt={draftPrompt}
              typeFilter={preview.typeFilter}
              previewing={preview.previewing}
              previewFragments={preview.fragments}
              onName={(name) =>
                void scope.dispatch({ type: "setDraftName", name })
              }
              onPrompt={(prompt) =>
                void scope.dispatch({ type: "setDraftPrompt", prompt })
              }
              onTypeFilter={preview.setTypeFilter}
              seededCount={seedExamples.length}
            />
          ) : selected ? (
            <ColourDetailPane
              key={selected.id}
              colour={selected}
              count={countByColour.get(selected.id) ?? 0}
              members={members}
              membersLoading={memberQuery.isLoading}
              onDeleted={() =>
                void scope.dispatch({ type: "selectColour", id: null })
              }
            />
          ) : (
            <EmptyState centered className="px-8 py-6">
              Select a colour to see its definition and tagged fragments, or
              create a new one.
            </EmptyState>
          )}
        </div>
      </PageCard>
    </>
  );
}
