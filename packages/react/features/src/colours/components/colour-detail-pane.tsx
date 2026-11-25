import {
  deleteColour,
  rematchColour,
  type UpdateColourInput,
  updateColour,
} from "@kalaido/client/kalaidoscope/colours";
import type { ColourResponse } from "@kalaido/client/kalaidoscope/types";
import { fragmentTypeLabel } from "@kalaido/client/lib/labels";
import { useFragmentSearch } from "@kalaido/components/context-picker/data";
import { ItemPicker } from "@kalaido/components/context-picker/item-picker";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import {
  ColourSwatch,
  ConfirmDialog,
  EditableText,
  EmptyState,
  FragmentCard,
  Label,
  Mono,
  type StatusKind,
  StatusPill,
} from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Textarea } from "@kalaido/primitives/shadcn/textarea";
import { useExternalWrite } from "@kalaido/state/live";
import {
  ArrowUUpLeftIcon,
  PlusIcon,
  PushPinIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
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
  ingest: { label: "imported", kind: "yellow" },
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
  onDeleted,
}: {
  colour: ColourResponse;
  count: number;
  members: MemberRow[];
  membersLoading: boolean;
  /** The colour is gone; the page drops the selection. */
  onDeleted: () => void;
}) {
  const client = useKalaidoscopeClient();
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const search = useFragmentSearch(adding ? query : "");
  const memberIds = new Set(members.map((m) => m.fragment_id));

  const patchWrite = useExternalWrite<UpdateColourInput, void>({
    execute: async (input) =>
      (await updateColour(colour.id, input)).map(() => undefined),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "colour"),
      kalaidoscopeCollectionTag(client.baseURL, "colour_fragment"),
    ],
  });

  const exampleWrite = useExternalWrite<UpdateColourInput, void>({
    execute: async (input) =>
      (await updateColour(colour.id, input)).map(() => undefined),
    concurrency: "allow",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "colour_fragment"),
    ],
  });

  const rematchWrite = useExternalWrite<void, void>({
    execute: () => rematchColour(colour.id),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "colour_fragment"),
    ],
  });

  const deleteWrite = useExternalWrite<void, void>({
    execute: () => deleteColour(colour.id),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "colour"),
      kalaidoscopeCollectionTag(client.baseURL, "colour_fragment"),
    ],
  });

  async function savePrompt() {
    if (editingPrompt === null) return;
    const outcome = await patchWrite.run({ prompt: editingPrompt.trim() });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to update prompt", {
        description: outcome.error.message,
      });
      return;
    }
    setEditingPrompt(null);
  }

  async function rename(name: string) {
    const outcome = await patchWrite.run({ name });
    if (outcome.status === "error") {
      toast.error("Failed to rename colour", {
        description: outcome.error.message,
      });
    }
  }

  async function example(input: UpdateColourInput) {
    const outcome = await exampleWrite.run(input);
    if (outcome.status === "error") {
      toast.error("Failed to update example", {
        description: outcome.error.message,
      });
    }
  }

  async function rematch() {
    const outcome = await rematchWrite.run();
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to restart matching", {
        description: outcome.error.message,
      });
      return;
    }
    toast("Matching restarted", {
      description: "Members refresh as fragments are re-judged.",
    });
  }

  async function remove() {
    const outcome = await deleteWrite.run();
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to delete colour", {
        description: outcome.error.message,
      });
      return;
    }
    onDeleted();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
      <div className="flex items-center gap-3">
        <ColourSwatch
          c={colour.swatch ?? 0}
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
        <Button
          variant="outline"
          disabled={rematchWrite.isPending}
          onClick={() => void rematch()}
        >
          Rematch
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="destructive" disabled={deleteWrite.isPending}>
              Delete
            </Button>
          }
          title="Delete this colour?"
          description="Its members and examples go with it, and any projection or reflection using it as context stops doing so."
          confirmLabel="Delete"
          onConfirm={() => void remove()}
        />
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
              <Button
                variant="commit"
                disabled={patchWrite.isPending}
                onClick={() => void savePrompt()}
              >
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
                        {shortTime(frag?.occurred_at ?? frag?.created)}
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
                        <ArrowUUpLeftIcon className="size-3.5" />
                      </CardAction>
                    ) : (
                      <>
                        <CardAction
                          title="Pin as example"
                          onClick={() =>
                            void example({ positiveExamples: [m.fragment_id] })
                          }
                        >
                          <PushPinIcon className="size-3.5" />
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
