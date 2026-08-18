import { useState } from "react";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ColourSwatch,
  EmptyState,
  FragmentCard,
  Label,
  Mono,
} from "@/components/kalaido";
import { updateColour } from "@/api/kalaidoscope/colours";
import { swatchIndex } from "@/lib/colors";
import { fragmentTypeLabel } from "@/lib/labels";
import { type MemberRow, preview, shortTime } from "../fragments";
import type { ColourResponse } from "@/api/kalaidoscope/types";

/** Keyed by colour id at the call site so edit state resets when the selection
 *  changes. */
export function ColourDetailPane({
  colour,
  count,
  members,
  membersLoading,
  onCriteriaSaved,
  onMembersChanged,
}: {
  colour: ColourResponse;
  count: number;
  members: MemberRow[];
  membersLoading: boolean;
  /** Revalidate the colour list after the criteria change. */
  onCriteriaSaved: () => Promise<unknown>;
  /** Revalidate members + counts after a tag is rejected. */
  onMembersChanged: () => Promise<unknown>;
}) {
  const [editingCriteria, setEditingCriteria] = useState<string | null>(null);

  async function saveCriteria() {
    if (editingCriteria === null) return;
    const criteria = editingCriteria.trim();
    if (!criteria) return;
    const res = await updateColour(colour.id, { criteria });
    if (res.isErr()) {
      toast.error("Failed to update definition", {
        description: res.error.message,
      });
      return;
    }
    setEditingCriteria(null);
    await onCriteriaSaved();
  }

  async function rejectTag(fragmentId: string) {
    const res = await updateColour(colour.id, {
      negativeExamples: [fragmentId],
    });
    if (res.isErr()) {
      toast.error("Failed to reject tag", { description: res.error.message });
      return;
    }
    await onMembersChanged();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
      <div className="flex items-center gap-3">
        <ColourSwatch
          c={swatchIndex(colour.id)}
          value={colour.colour_value || undefined}
          size={30}
          className="rounded-[7px]"
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-card-title font-bold text-fg-1">
            {colour.name || "Untitled colour"}
          </span>
          <Mono className="text-meta text-fg-4">
            {count} fragments · AI-tagged
          </Mono>
        </div>
      </div>

      <div className="rounded-none border border-line bg-surface-2 p-4">
        <Label className="mb-2 block">Filter prompt</Label>
        {editingCriteria !== null ? (
          <div className="flex flex-col gap-2.5">
            <Textarea
              value={editingCriteria}
              onChange={(e) => setEditingCriteria(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                variant="commit"
                disabled={!editingCriteria.trim()}
                onClick={() => void saveCriteria()}
              >
                Save definition
              </Button>
              <Button variant="ghost" onClick={() => setEditingCriteria(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Mono className="text-body leading-relaxed text-fg-1">
              “{colour.criteria || "No criteria set"}”
            </Mono>
            <div className="mt-3.5 flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditingCriteria(colour.criteria ?? "")}
              >
                Refine definition
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Member fragments</Label>
          <Mono className="text-meta text-fg-4">
            reject a tag → refines the filter
          </Mono>
        </div>
        {members.length === 0 ? (
          <EmptyState>
            {membersLoading
              ? "Loading members…"
              : "No fragments tagged yet — tagging runs in the background."}
          </EmptyState>
        ) : (
          <div className="flex flex-wrap gap-3">
            {members.map((m) => {
              const frag = m.expand?.fragment_id;
              const rejected = m.match_type === "manual_negative";
              return (
                <div key={m.id} className="group relative w-[calc(50%-6px)]">
                  <FragmentCard
                    type={fragmentTypeLabel(frag?.type ?? "")}
                    time={shortTime(frag?.source_time ?? frag?.created)}
                    rejected={rejected}
                    preview={frag ? preview(frag.content) : undefined}
                  />
                  {!rejected && (
                    <button
                      type="button"
                      onClick={() => void rejectTag(m.fragment_id)}
                      title="Reject this tag"
                      className="absolute right-2 top-2 hidden size-5 items-center justify-center rounded-none bg-surface-2 text-fg-3 hover:text-critical-ink group-hover:flex"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
