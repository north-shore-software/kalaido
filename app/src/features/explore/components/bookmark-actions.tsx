import { FileTextIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Label } from "@/components/kalaido/text";
import { ItemPicker } from "@/components/kalaido/context-picker/item-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCollection } from "@/hooks/use-collection";
import { cn } from "@/lib/css-utils";
import { deriveName } from "@/lib/naming";
import type {
  BookmarkActionPhase,
  BriefedBookmarks,
} from "../hooks/use-bookmark-actions";

export interface ProjectionStart {
  name: string;
  message: string;
  fragmentIds: string[];
}

interface BookmarkActionsProps {
  /** How many bookmarked turns there are, and how many are already saved. */
  count: number;
  savedCount: number;
  phase: BookmarkActionPhase;
  error?: string;
  onSaveAll: () => void;
  onSaveAndColour: (colourId: string, colourName: string) => void;
  onNewColour: () => void;
  /** Save, then write the brief; resolves null when either failed. */
  onBrief: () => Promise<BriefedBookmarks | null>;
  onStartProjection: (start: ProjectionStart) => void;
}

const PHASE_COPY: Record<Exclude<BookmarkActionPhase, "idle">, string> = {
  saving: "Saving fragments…",
  colouring: "Applying colour…",
  briefing: "Writing the brief…",
};

/**
 * What to do with everything bookmarked, once. Saving is the plain act;
 * adding a colour saves first and then pins the fragments as its examples,
 * either into a colour that exists or into a new one composed from them;
 * making a projection saves, has the model write the brief the session was
 * working towards, and shows it for editing before anything starts.
 */
export function BookmarkActions({
  count,
  savedCount,
  phase,
  error,
  onSaveAll,
  onSaveAndColour,
  onNewColour,
  onBrief,
  onStartProjection,
}: BookmarkActionsProps) {
  const [picking, setPicking] = useState(false);
  const [brief, setBrief] = useState<BriefedBookmarks | null>(null);
  const colours = useCollection("colour", {
    sort: "-created",
    fields: "id,name,swatch",
  });
  const busy = phase !== "idle";
  const allSaved = count > 0 && savedCount === count;

  if (brief) {
    return (
      <BriefEditor
        brief={brief}
        onBack={() => setBrief(null)}
        onStart={(name, message) =>
          onStartProjection({
            name,
            message,
            fragmentIds: brief.fragmentIds,
          })
        }
      />
    );
  }

  return (
    <>
      <Button
        variant="section"
        onClick={onSaveAll}
        disabled={busy || count === 0 || allSaved}
      >
        {phase === "saving"
          ? "Saving…"
          : allSaved
            ? "All saved as fragments"
            : "Save as fragments"}
      </Button>

      <div className="relative flex items-center gap-2">
        <button
          type="button"
          aria-pressed={picking}
          aria-expanded={picking}
          disabled={busy || count === 0}
          title="Save as fragments and add them to a colour"
          onClick={() => setPicking((p) => !p)}
          className={cn(
            "shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-pill font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40",
            picking
              ? "border-section-edge bg-section-wash text-section-ink"
              : "border-line-strong text-fg-4 hover:text-fg-2",
          )}
        >
          <PlusIcon className="mr-1 inline size-2.5" />
          Colour
        </button>
        <Button
          variant="ghost"
          size="xs"
          className="text-fg-3"
          disabled={busy || count === 0}
          onClick={onNewColour}
        >
          New colour…
        </Button>
        {picking && (
          <ItemPicker
            kindLabel="Colour"
            tint="section"
            options={colours.records.map((c) => ({
              id: c.id,
              label: c.name || "Untitled colour",
              swatch: c.swatch,
            }))}
            loading={colours.isLoading}
            onPick={(o) => {
              setPicking(false);
              onSaveAndColour(o.id, o.label);
            }}
            onClose={() => setPicking(false)}
            emptyCopy="No colours yet — compose a new one from these."
          />
        )}
      </div>

      <Button
        variant="ghost"
        className="justify-start text-fg-3"
        disabled={busy || count === 0}
        onClick={() => {
          void onBrief().then((b) => {
            if (b) setBrief(b);
          });
        }}
      >
        <FileTextIcon />
        Make a projection
      </Button>

      {busy && (
        <p className="font-mono text-mono-sm text-fg-4">{PHASE_COPY[phase]}</p>
      )}
      {error && !busy && <p className="text-meta text-critical-ink">{error}</p>}
    </>
  );
}

/**
 * The brief, before it is acted on: the model's guess at what the session
 * was working towards, in the user's words, for them to correct. Starting is
 * the one decision on this screen, so it wears the commit button.
 */
function BriefEditor({
  brief,
  onBack,
  onStart,
}: {
  brief: BriefedBookmarks;
  onBack: () => void;
  onStart: (name: string, message: string) => void;
}) {
  const [message, setMessage] = useState(brief.message);
  const [name, setName] = useState(
    brief.name || deriveName(brief.message, "Untitled projection"),
  );
  const ready = message.trim().length > 0;
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label>Brief</Label>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
        />
        <p className="text-meta text-fg-4">
          Sent as the first message of the projection and kept as its
          description.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="commit"
          disabled={!ready}
          onClick={() =>
            onStart(
              name.trim() || deriveName(message, "Untitled projection"),
              message.trim(),
            )
          }
        >
          Start projection
        </Button>
      </div>
    </>
  );
}
