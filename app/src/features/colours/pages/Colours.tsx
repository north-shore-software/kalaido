import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createColour } from "@/api/kalaidoscope/colours";
import { EmptyState } from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { useCollection } from "@/hooks/use-collection";
import { defineRoute } from "@/routes/route-kit";
import { ColourComposerPane } from "../components/colour-composer-pane";
import { ColourDetailPane } from "../components/colour-detail-pane";
import { ColourList } from "../components/colour-list";
import { isMember, type MemberRow } from "../fragments";
import { useColourPreview } from "../hooks/use-colour-preview";
import { coloursTransitions } from "./Colours.transitions";

export default function Colours() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const colours = useCollection("colour", {
    sort: "-created",
    fields: "id,name,prompt,colour_value",
  });

  const allLinks = useCollection("colour_fragment", {
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

  const memberQuery = useCollection("colour_fragment", {
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

  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const preview = useColourPreview(draftPrompt, composing);

  function openComposer() {
    setComposing(true);
    setDraftName("");
    setDraftPrompt("");
  }

  function selectColour(id: string) {
    setComposing(false);
    setSelectedId(id);
  }

  async function saveNew() {
    const name = draftName.trim();
    const prompt = draftPrompt.trim();
    if (!name || !prompt || saving) return;
    setSaving(true);
    const res = await createColour({
      name,
      prompt,
      // Seed every match, not the type-filtered view — the colour matches on the
      // prompt regardless of type; the chip is only a preview convenience.
      fragmentIds: preview.matches.map((f) => f.id),
    });
    setSaving(false);
    if (res.isErr()) {
      toast.error("Failed to create colour", {
        description: res.error.message,
      });
      return;
    }
    await colours.mutate();
    setComposing(false);
    setSelectedId(res.value.colourId);
  }

  return (
    <PageLayout>
      <PageHeader
        title="Colours"
        actions={
          composing ? (
            <>
              <Button variant="ghost" onClick={() => setComposing(false)}>
                Cancel
              </Button>
              <Button
                variant="commit"
                disabled={!draftName.trim() || !draftPrompt.trim() || saving}
                onClick={() => void saveNew()}
              >
                {saving ? "Creating…" : "Create colour"}
              </Button>
            </>
          ) : (
            <Button variant="section" onClick={openComposer}>
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
            onSelect={selectColour}
          />
          {composing ? (
            <ColourComposerPane
              name={draftName}
              prompt={draftPrompt}
              typeFilter={preview.typeFilter}
              previewing={preview.previewing}
              previewFragments={preview.fragments}
              onName={setDraftName}
              onPrompt={setDraftPrompt}
              onTypeFilter={preview.setTypeFilter}
            />
          ) : selected ? (
            <ColourDetailPane
              key={selected.id}
              colour={selected}
              count={countByColour.get(selected.id) ?? 0}
              members={members}
              membersLoading={memberQuery.isLoading}
              onColourChanged={() => colours.mutate()}
              onDeleted={async () => {
                setSelectedId(null);
                await Promise.all([colours.mutate(), allLinks.mutate()]);
              }}
              onMembersChanged={() =>
                Promise.all([memberQuery.mutate(), allLinks.mutate()])
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
    </PageLayout>
  );
}

export const coloursRoute = defineRoute({
  id: "colours",
  path: "/colours",
  feature: "Colours",
  requiredScope: ["kalaidoscope"],
  transitions: coloursTransitions,
  Component: Colours,
});
