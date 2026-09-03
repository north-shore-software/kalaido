import { PinIcon, PlusIcon, Undo2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteColour,
  rematchColour,
  type UpdateColourInput,
  updateColour,
} from "@/api/kalaidoscope/colours";
import type { ColourResponse } from "@/api/kalaidoscope/types";
import {
  ColourSwatch,
  EditableText,
  EmptyState,
  FragmentCard,
  Label,
  Mono,
  type StatusKind,
  StatusPill,
} from "@/components/kalaido";
import { useFragmentSearch } from "@/components/kalaido/context-picker/data";
import { ItemPicker } from "@/components/kalaido/context-picker/item-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { swatchIndex } from "@/lib/colors";
import { fragmentTypeLabel } from "@/lib/labels";
import {
  type MatchType,
  type MemberRow,
  preview,
  shortTime,
} from "../fragments";

/** How a membership row reads on its card. Exclusions render via `rejected`. */
const MATCH_BADGE: Record<
  Exclude<MatchType, "manual_negative">,
  { label: string; kind: StatusKind }
> = {
  manual_positive: { label: "pinned", kind: "magenta" },
  thing: { label: "from map", kind: "cyan" },
  prompt: { label: "matched", kind: "neutral" },
};

/** Keyed by colour id at the call site so edit state resets when the selection
 *  changes. */
export function ColourDetailPane({
  colour,
  count,
  members,
  membersLoading,
  onColourChanged,
  onDeleted,
  onMembersChanged,
}: {
  colour: ColourResponse;
  count: number;
  members: MemberRow[];
  membersLoading: boolean;
  /** Revalidate the colour list after a rename or prompt change. */
  onColourChanged: () => Promise<unknown>;
  /** The colour is gone; the page drops the selection. */
  onDeleted: () => Promise<unknown>;
  /** Revalidate members + counts after an example changes. */
  onMembersChanged: () => Promise<unknown>;
}) {
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const search = useFragmentSearch(adding ? query : "");
  const memberIds = new Set(members.map((m) => m.fragment_id));

  async function patch(input: UpdateColourInput, failure: string) {
    const res = await updateColour(colour.id, input);
    if (res.isErr()) {
      toast.error(failure, { description: res.error.message });
      return false;
    }
    return true;
  }

  async function savePrompt() {
    if (editingPrompt === null) return;
    if (
      await patch({ prompt: editingPrompt.trim() }, "Failed to update prompt")
    ) {
      setEditingPrompt(null);
      await Promise.all([onColourChanged(), onMembersChanged()]);
    }
  }

  async function rename(name: string) {
    if (await patch({ name }, "Failed to rename colour"))
      await onColourChanged();
  }

  async function example(input: UpdateColourInput) {
    if (await patch(input, "Failed to update example"))
      await onMembersChanged();
  }

  async function rematch() {
    const res = await rematchColour(colour.id);
    if (res.isErr()) {
      toast.error("Failed to restart matching", {
        description: res.error.message,
      });
      return;
    }
    toast("Matching restarted", {
      description: "Members refresh as fragments are re-judged.",
    });
    await onMembersChanged();
  }

  async function remove() {
    const res = await deleteColour(colour.id);
    if (res.isErr()) {
      toast.error("Failed to delete colour", {
        description: res.error.message,
      });
      return;
    }
    await onDeleted();
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
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <EditableText
            value={colour.name || "Untitled colour"}
            onCommit={(next) => void rename(next)}
            className="text-card-title font-bold text-fg-1"
            aria-label="Colour name"
          />
          <Mono className="text-meta text-fg-4">
            {count} fragment{count === 1 ? "" : "s"}
          </Mono>
        </div>
        <Button variant="outline" onClick={() => void rematch()}>
          Rematch
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="destructive">Delete</Button>}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this colour?</AlertDialogTitle>
              <AlertDialogDescription>
                Its members and examples go with it, and any projection or
                reflection using it as context stops doing so.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="rounded-none border border-line bg-surface-2 p-4">
        <Label className="mb-2 block">Prompt</Label>
        {editingPrompt !== null ? (
          <div className="flex flex-col gap-2.5">
            <Textarea
              value={editingPrompt}
              onChange={(e) => setEditingPrompt(e.target.value)}
              rows={3}
              placeholder="What should this colour match?"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="commit" onClick={() => void savePrompt()}>
                Save prompt
              </Button>
              <Button variant="ghost" onClick={() => setEditingPrompt(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : colour.prompt ? (
          <>
            <Mono className="text-body leading-relaxed text-fg-1">
              “{colour.prompt}”
            </Mono>
            <div className="mt-3.5 flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditingPrompt(colour.prompt)}
              >
                Refine prompt
              </Button>
            </div>
          </>
        ) : (
          <>
            <Mono className="text-body-sm text-fg-3">
              No prompt. Members come from the map and your examples.
            </Mono>
            <div className="mt-3.5 flex gap-2">
              <Button variant="outline" onClick={() => setEditingPrompt("")}>
                Add a prompt
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Members</Label>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            <PlusIcon />
            Add example
          </Button>
        </div>
        {adding && (
          <ItemPicker
            kindLabel="Fragment"
            tint="section"
            options={search.options.filter((o) => !memberIds.has(o.id))}
            remoteFiltered
            loading={search.loading}
            onQueryChange={setQuery}
            onPick={(o) => {
              setAdding(false);
              setQuery("");
              void example({ positiveExamples: [o.id] });
            }}
            onClose={() => {
              setAdding(false);
              setQuery("");
            }}
            emptyCopy="Search fragments by content to pin one as a member."
          />
        )}
        {members.length === 0 ? (
          <EmptyState>
            {membersLoading
              ? "Loading members…"
              : "No members yet. Matching runs in the background; pin an example to start."}
          </EmptyState>
        ) : (
          <div className="flex flex-wrap gap-3">
            {members.map((m) => {
              const frag = m.expand?.fragment_id;
              const rejected = m.match_type === "manual_negative";
              const manual = rejected || m.match_type === "manual_positive";
              const badge =
                m.match_type === "manual_negative"
                  ? null
                  : MATCH_BADGE[m.match_type];
              return (
                <div key={m.id} className="group relative w-[calc(50%-6px)]">
                  <FragmentCard
                    type={fragmentTypeLabel(frag?.type ?? "")}
                    time={
                      <span className="flex items-center gap-1.5">
                        {badge && (
                          <StatusPill kind={badge.kind}>
                            {badge.label}
                          </StatusPill>
                        )}
                        {shortTime(frag?.source_time ?? frag?.created)}
                      </span>
                    }
                    rejected={rejected}
                    preview={frag ? preview(frag.content) : undefined}
                  />
                  <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                    {manual ? (
                      <CardAction
                        title={rejected ? "Undo exclusion" : "Unpin"}
                        onClick={() =>
                          void example({ clearExamples: [m.fragment_id] })
                        }
                      >
                        <Undo2Icon className="size-3.5" />
                      </CardAction>
                    ) : (
                      <>
                        <CardAction
                          title="Pin as example"
                          onClick={() =>
                            void example({ positiveExamples: [m.fragment_id] })
                          }
                        >
                          <PinIcon className="size-3.5" />
                        </CardAction>
                        <CardAction
                          title="Exclude"
                          critical
                          onClick={() =>
                            void example({ negativeExamples: [m.fragment_id] })
                          }
                        >
                          <XIcon className="size-3.5" />
                        </CardAction>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CardAction({
  title,
  critical,
  onClick,
  children,
}: {
  title: string;
  critical?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={
        critical
          ? "flex size-5 items-center justify-center rounded-none bg-surface-2 text-fg-3 hover:text-critical-ink"
          : "flex size-5 items-center justify-center rounded-none bg-surface-2 text-fg-3 hover:text-fg-1"
      }
    >
      {children}
    </button>
  );
}
