import {
  ArrowUUpLeftIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  PencilSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { UIMessage } from "ai";
import { Fragment, type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  CONTEXT_CANCEL_PART_TYPE,
  CONTEXT_CONFIRM_PART_TYPE,
  CONTEXT_CONFIRMATION_PART_TYPE,
  type ContextConfirmation,
  type ContextItem,
  type ContextSpec,
  diffContextSpecs,
  messageContextSpec,
  messageWindow,
  REGENERATE_CANCEL_PART_TYPE,
  REGENERATE_CONFIRM_PART_TYPE,
  REGENERATE_CONFIRMATION_PART_TYPE,
  specToItems,
  type TimeWindow,
} from "@/api/kalaidoscope/chat";
import type { SnapshotEdit } from "@/api/kalaidoscope/projections";
import { useContextSources } from "@/hooks/use-context-sources";
import { useFragmentLabels } from "@/hooks/use-fragment-labels";
import { cn } from "@/lib/css-utils";
import { formatWindowRange } from "@/lib/datetime";
import { mentionsToTags, splitMentions } from "@/lib/mentions";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ColourSwatch } from "./colour";
import { KIND_ABBREV } from "./context-bar/state";
import { EditDiffBoxes } from "./edit-diff-boxes";
import { MarkdownContent } from "./markdown-content";

export interface MessageBubbleProps {
  role: string;
  content: string;
  /**
   * Controls shown beneath the bubble, revealed on hover. Kept as an opaque
   * slot so this component stays presentational — what can be *done* with a
   * message is the caller's business, not the transcript's.
   */
  actions?: ReactNode;
  /**
   * Keep the actions row visible rather than hover-revealed — for a message
   * whose state (bookmarked, saved) the reader should see at a glance.
   */
  actionsVisible?: boolean;
}

/**
 * Message text with mention tokens rendered as chips. The raw `@[Kind:id|Label]`
 * wire form is what persists (see lib/mentions.ts), so this is the one place
 * transcripts translate it back into something readable. Untagged messages
 * come back as a single text segment and render exactly as before.
 */
function MessageText({ content }: { content: string }) {
  const segments = splitMentions(content);
  if (segments.length === 1 && segments[0].type === "text") return content;
  return segments.map((seg, i) =>
    seg.type === "mention" ? (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are a pure derivation of content
        key={i}
        // `currentColor`-derived so the chip reads on both the primary (user)
        // and muted (assistant) bubble backgrounds without per-role styling.
        className="inline rounded-none border border-current/25 bg-current/10 px-1 font-medium whitespace-nowrap"
      >
        @{seg.label}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are a pure derivation of content
      <span key={i}>{seg.text}</span>
    ),
  );
}

/**
 * The same chip, reachable from inside rendered markdown: `mentionsToTags`
 * rewrites the wire tokens into <kmention> tags, allowlisted below so the
 * label rides through sanitization as literal text rather than prose.
 */
const mentionTagComponents = {
  kmention: (props: Record<string, unknown>) => (
    <span className="inline rounded-none border border-current/25 bg-current/10 px-1 font-medium whitespace-nowrap">
      {props.children as ReactNode}
    </span>
  ),
};
const mentionAllowedTags = { kmention: [] as string[] };
const mentionLiteralTags = ["kmention"];

export function MessageBubble({
  role,
  content,
  actions,
  actionsVisible,
}: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "group/message flex flex-col gap-1",
        role === "user" ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-[70%] rounded-none px-4 py-2.5 text-body-sm leading-relaxed break-words",
          role === "user"
            ? "bg-section text-section-foreground font-medium whitespace-pre-wrap"
            : "bg-surface-2 text-fg-1",
        )}
      >
        {role === "user" ? (
          // User text is verbatim input — rendering a literal `# note` as a
          // heading would misrepresent what was typed.
          <MessageText content={content} />
        ) : (
          <MarkdownContent
            variant="chat"
            streaming
            content={mentionsToTags(content)}
            components={mentionTagComponents}
            allowedTags={mentionAllowedTags}
            literalTagContent={mentionLiteralTags}
          />
        )}
      </div>
      {actions && (
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100",
            !actionsVisible && "opacity-0",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Marks where the context changed in the transcript, with the same change the
 * next turn's prompt was built from. Spec-level and diffed against the previous
 * spec in the stream (see {@link diffContextSpecs}); the opening spec of a
 * conversation renders as a plain summary, except the default whole scope of a
 * fresh chat, which is not a change worth marking. A re-emitted identical spec
 * diffs to nothing and renders nothing.
 */
/**
 * Display labels for context items that came off the wire as bare ids,
 * resolved the way the context bar resolves them. Shared by the context
 * divider and the context-change confirmation card.
 */
function useContextItemDisplay(items: ContextItem[]) {
  const sources = useContextSources();
  const fragmentIds = useMemo(
    () => items.filter((it) => it.kind === "Fragment").map((it) => it.id),
    [items],
  );
  const fragmentLabels = useFragmentLabels(fragmentIds);

  const label = (it: ContextItem): string => {
    switch (it.kind) {
      case "WholeScope":
        return "whole scope";
      case "Summaries":
        return "summaries";
      case "Type":
        return sources.types.find((s) => s.value === it.id)?.label ?? it.label;
      case "Colour":
        return sources.colours.find((s) => s.id === it.id)?.name ?? it.label;
      case "Projection":
        return (
          sources.projections.find((s) => s.id === it.id)?.name ?? it.label
        );
      case "Reflection":
        return (
          sources.reflections.find((s) => s.id === it.id)?.name ?? it.label
        );
      case "Fragment":
        return fragmentLabels.get(it.id) ?? it.label;
    }
  };
  const swatch = (it: ContextItem): number | undefined =>
    it.kind === "Colour"
      ? sources.colours.find((s) => s.id === it.id)?.swatch
      : undefined;

  /** The item as the context bar would hold it: label and swatch resolved. */
  const labelled = (it: ContextItem): ContextItem => {
    if (it.kind === "WholeScope" || it.kind === "Summaries") return it;
    const s = swatch(it);
    return s == null
      ? { ...it, label: label(it) }
      : { ...it, label: label(it), swatch: s };
  };

  return { label, swatch, labelled };
}

function ContextEntry({
  it,
  sign,
  display,
}: {
  it: ContextItem;
  sign: "+" | "−" | null;
  display: ReturnType<typeof useContextItemDisplay>;
}) {
  const swatch = display.swatch(it);
  return (
    <span
      className={cn(
        "inline-flex max-w-56 items-center gap-1 whitespace-nowrap",
        sign === "−" && "text-fg-5 line-through",
      )}
    >
      {sign && <span className="shrink-0">{sign}</span>}
      {it.kind !== "WholeScope" &&
        it.kind !== "Summaries" &&
        it.kind !== "Fragment" && (
          <span className="shrink-0 text-[9px] font-bold uppercase text-fg-5">
            {KIND_ABBREV[it.kind]}
          </span>
        )}
      {swatch != null && <ColourSwatch c={swatch} size={8} />}
      <span className="min-w-0 truncate">
        {it.kind === "Fragment" ? `@${display.label(it)}` : display.label(it)}
      </span>
    </span>
  );
}

function ContextSpecDivider({
  spec,
  prevSpec,
}: {
  spec: ContextSpec;
  prevSpec: ContextSpec | null;
}) {
  const delta = useMemo(
    () => diffContextSpecs(prevSpec, spec),
    [prevSpec, spec],
  );
  const changed = useMemo(() => [...delta.added, ...delta.removed], [delta]);
  const display = useContextItemDisplay(changed);

  const isFirst = prevSpec === null;
  if (delta.added.length === 0 && delta.removed.length === 0) return null;
  if (
    isFirst &&
    delta.added.length === 1 &&
    delta.added[0].kind === "WholeScope"
  ) {
    return null;
  }

  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="h-px flex-1 bg-line" />
      <div className="flex max-w-[80%] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 font-mono text-mono-sm text-fg-4">
        <span className="font-bold uppercase text-fg-5">Context</span>
        {delta.added.map((it) => (
          <ContextEntry
            key={`+:${it.kind}:${it.id}`}
            it={it}
            sign={isFirst ? null : "+"}
            display={display}
          />
        ))}
        {delta.removed.map((it) => (
          <ContextEntry
            key={`−:${it.kind}:${it.id}`}
            it={it}
            sign="−"
            display={display}
          />
        ))}
      </div>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

interface ContextConfirmationCardProps {
  confirmation: ContextConfirmation;
  /** The spec in force when the proposal was made, for the +/− summary. */
  prevSpec: ContextSpec | null;
  onConfirm?: (spec: ContextSpec, items: ContextItem[]) => void;
  onCancel?: () => void;
  isBusy?: boolean;
  isSettled?: boolean;
}

/**
 * The assistant proposed a context change. The card shows the model's
 * reason and the items that would enter or leave, and the user's answer goes
 * back through the chat: a confirm carries the new spec as an ordinary
 * `context_spec` message, a cancel only records the refusal.
 */
function ContextConfirmationCard({
  confirmation,
  prevSpec,
  onConfirm,
  onCancel,
  isBusy,
  isSettled,
}: ContextConfirmationCardProps) {
  const nextItems = useMemo(
    () => specToItems(confirmation.spec),
    [confirmation.spec],
  );
  const delta = useMemo(
    () => diffContextSpecs(prevSpec, confirmation.spec),
    [prevSpec, confirmation.spec],
  );
  const involved = useMemo(
    () => [...nextItems, ...delta.removed],
    [nextItems, delta],
  );
  const display = useContextItemDisplay(involved);
  const unchanged = delta.added.length === 0 && delta.removed.length === 0;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-none border border-line bg-surface-2 p-3 space-y-2.5 text-body-sm">
        <div className="font-medium text-fg-1">Change the context?</div>
        {confirmation.reason && (
          <div className="text-fg-2">{confirmation.reason}</div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-mono-sm text-fg-4">
          {unchanged ? (
            <span className="text-fg-3 text-caption">
              This would leave the context as it is.
            </span>
          ) : (
            <>
              {delta.added.map((it) => (
                <ContextEntry
                  key={`+:${it.kind}:${it.id}`}
                  it={it}
                  sign="+"
                  display={display}
                />
              ))}
              {delta.removed.map((it) => (
                <ContextEntry
                  key={`−:${it.kind}:${it.id}`}
                  it={it}
                  sign="−"
                  display={display}
                />
              ))}
            </>
          )}
        </div>
        {!isSettled && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="xs"
              onClick={() =>
                onConfirm?.(confirmation.spec, nextItems.map(display.labelled))
              }
              disabled={isBusy || unchanged}
            >
              Apply change
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={onCancel}
              disabled={isBusy}
            >
              Keep as is
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Marks where a reflection refinement's target window was set or moved. The
 * first one states the window; later ones show it changing.
 */
function WindowDivider({
  window: win,
  isFirst,
}: {
  window: TimeWindow;
  isFirst: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="h-px flex-1 bg-line" />
      <div className="flex max-w-[80%] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 font-mono text-mono-sm text-fg-4">
        <span className="font-bold uppercase text-fg-5">Window</span>
        <span className="whitespace-nowrap">
          {isFirst ? "" : "→ "}
          {formatWindowRange(win.start, win.end)}
        </span>
      </div>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

// null = the tool is bookkeeping the user never needs narrated (its effect
// shows up elsewhere in the UI), so a text-less turn stays silent.
// apply_result is the server-fabricated part carrying the executed preview —
export type EditNoticeKind = "hand_edit" | "refine_target" | "triage";

export interface SystemEditNotice {
  kind: EditNoticeKind;
  editId?: string;
  sequence?: number;
  status?: "approved" | "rejected" | "proposed";
  passage?: string;
  before?: string;
  after?: string;
  rawText?: string;
}

// The server-written notice naming which accepted edits a regeneration
// superseded (and which still stand); rendered as a plain notice row.
function supersededNoticeFor(msg: UIMessage): string | null {
  for (const part of msg.parts) {
    const p = part as { type?: string; text?: string };
    if (p.type === "data-regenerate_superseded" && p.text?.trim()) {
      return p.text;
    }
  }
  return null;
}

function editNoticeFor(msg: UIMessage): SystemEditNotice | null {
  for (const part of msg.parts) {
    const p = part as {
      type?: string;
      text?: string;
      data?: {
        editId?: string;
        sequence?: number;
        status?: "approved" | "rejected" | "proposed";
        before?: string;
        after?: string;
        passage?: string;
      };
    };
    if (p.type === "data-hand_edit") {
      return {
        kind: "hand_edit",
        editId: p.data?.editId,
        sequence: p.data?.sequence,
        before: p.data?.before,
        after: p.data?.after,
        rawText: p.text,
      };
    }
    if (p.type === "data-refine_target") {
      return {
        kind: "refine_target",
        editId: p.data?.editId,
        passage: p.data?.passage,
        rawText: p.text,
      };
    }
    if (p.type === "data-edit_triage") {
      return {
        kind: "triage",
        editId: p.data?.editId,
        sequence: p.data?.sequence,
        status: p.data?.status,
        rawText: p.text,
      };
    }
  }
  return null;
}

export interface EditNoticeCardProps {
  notice: SystemEditNotice;
  isHighlighted?: boolean;
  liveEdit?: SnapshotEdit;
  onUndoEdit?: (editId: string) => void;
  isBusy?: boolean;
}

function EditNoticeCard({
  notice,
  isHighlighted,
  liveEdit,
  onUndoEdit,
  isBusy,
}: EditNoticeCardProps) {
  const isHandEdit = notice.kind === "hand_edit";
  const isRefine = notice.kind === "refine_target";
  const isTriage = notice.kind === "triage";
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  const isUndone =
    isTriage &&
    (notice.status === "proposed" || liveEdit?.status === "proposed");
  const canUndo =
    isTriage &&
    !isUndone &&
    (notice.status === "approved" || notice.status === "rejected");
  const isUndoable = canUndo && liveEdit?.undoable === true;
  const undoReason = canUndo
    ? liveEdit?.undoReason || "another edit was made on top"
    : undefined;

  const label = isHandEdit
    ? notice.sequence
      ? `Hand edit #${notice.sequence} applied`
      : "Hand edit applied"
    : isRefine
      ? "Refine target selected"
      : notice.status === "proposed"
        ? notice.sequence
          ? `Edit #${notice.sequence} undone`
          : "Edit undone"
        : isUndone
          ? notice.status === "approved"
            ? `Edit #${notice.sequence} accepted (undone)`
            : `Edit #${notice.sequence} rejected (undone)`
          : notice.status === "approved"
            ? `Edit #${notice.sequence} accepted`
            : `Edit #${notice.sequence} rejected`;

  return (
    <div
      ref={cardRef}
      id={notice.editId ? `chat-edit-${notice.editId}` : undefined}
      className={cn(
        "my-1.5 scroll-mt-6 rounded-none border border-line bg-surface-2/60 text-xs text-fg-2 shadow-xs transition-all duration-700",
        isHighlighted && "ring-2 ring-magenta bg-magenta/10",
      )}
    >
      <div className="flex items-center justify-between border-b border-line/60 bg-surface-2 px-3 py-1.5 font-mono text-fg-3">
        <div className="flex items-center gap-1.5">
          {isHandEdit && (
            <PencilSimpleIcon className="size-3 shrink-0 text-fg-4" />
          )}
          {isRefine && (
            <ChatCircleDotsIcon className="size-3 shrink-0 text-fg-4" />
          )}
          {isTriage && notice.status === "approved" && (
            <CheckIcon className="size-3 shrink-0 text-stable" />
          )}
          {isTriage && notice.status === "rejected" && (
            <XIcon className="size-3 shrink-0 text-critical" />
          )}
          {isTriage && notice.status === "proposed" && (
            <ArrowUUpLeftIcon className="size-3 shrink-0 text-fg-3" />
          )}
          <span className="font-mono text-fg-2">{label}</span>
        </div>
        {canUndo && (
          <div>
            {isUndoable ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={() => notice.editId && onUndoEdit?.(notice.editId)}
                className="h-6 gap-1 px-2 text-xs font-sans text-fg-2 hover:bg-surface-3 cursor-pointer"
              >
                <ArrowUUpLeftIcon className="size-3" />
                Undo
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    // aria-disabled rather than disabled: a disabled button
                    // is unfocusable and unhoverable, which would hide the
                    // tooltip that explains why Undo is unavailable.
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-disabled="true"
                      className="h-6 gap-1 px-2 text-xs font-sans opacity-50 cursor-not-allowed"
                    >
                      <ArrowUUpLeftIcon className="size-3" />
                      Undo
                    </Button>
                  }
                />
                <TooltipContent side="top">{undoReason}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
      <div className="space-y-2 p-3 text-body-sm">
        {isHandEdit && (
          <EditDiffBoxes
            before={notice.before}
            after={notice.after}
            variant="chat"
          />
        )}
        {isRefine && notice.passage && (
          <div className="rounded-none border-l-2 border-line-focus bg-surface-1 px-3 py-2 italic text-fg-2">
            <MarkdownContent variant="chat" content={notice.passage} />
          </div>
        )}
        {isHandEdit && !notice.before && !notice.after && notice.rawText && (
          <div className="font-mono whitespace-pre-wrap text-fg-3">
            {notice.rawText}
          </div>
        )}
        {isRefine && !notice.passage && notice.rawText && (
          <div className="font-mono whitespace-pre-wrap text-fg-3">
            {notice.rawText}
          </div>
        )}
        {isTriage && (
          <p className="text-meta text-fg-3">
            {notice.rawText ||
              (notice.status === "approved"
                ? "The edit was approved."
                : notice.status === "rejected"
                  ? "The edit was rejected."
                  : "The edit decision was undone.")}
          </p>
        )}
      </div>
    </div>
  );
}

// its effect is the preview pane itself.
const TOOL_MESSAGES: Record<string, string | null> = {
  update_lens: "Updated the lens.",
  regenerate_from_lens: "Regenerating document from the lens...",
  refine_candidate: null,
  apply_result: null,
  suggest_name: null,
  // The confirmation card carries the proposal; nothing else to say.
  update_context: null,
  // The chat's summaries-mode reads narrate themselves (readNoticesFor).
  read_fragment: null,
  read_thing: null,
};

/**
 * One line per read the summaries-mode chat made during the turn. Handles both
 * the live shape (`dynamic-tool` with `toolName`/`input`) and the persisted one
 * (`tool-<name>` with `data.input`), like toolNoticeFor.
 */
function readNoticesFor(msg: UIMessage): string[] {
  const notices: string[] = [];
  for (const part of msg.parts) {
    const p = part as {
      type?: string;
      toolName?: string;
      input?: unknown;
      data?: { input?: unknown };
    };
    const name =
      p.type === "dynamic-tool"
        ? p.toolName
        : p.type?.startsWith("tool-")
          ? p.type.slice("tool-".length)
          : undefined;
    if (name !== "read_fragment" && name !== "read_thing") continue;
    const input = (p.input ?? p.data?.input) as { ids?: string[] } | undefined;
    const n = input?.ids?.length ?? 0;
    notices.push(
      name === "read_fragment"
        ? `Read ${n} fragment${n === 1 ? "" : "s"} in full.`
        : `Read ${n} thing${n === 1 ? "" : "s"} from the map.`,
    );
  }
  return notices;
}

/**
 * Notices the refinement server attaches to an assistant turn as `data-*`
 * parts (persisted and live shapes are identical): the count-pin lint and
 * apply failures. Rendered as italic rows under the turn; styling is minimal
 * on purpose (visual pass tracked in the design handoff).
 */
function dataNoticesFor(msg: UIMessage): string[] {
  const notices: string[] = [];
  for (const part of msg.parts) {
    const p = part as {
      type?: string;
      data?: {
        match?: string;
        message?: string;
        start?: string;
        end?: string;
        ok?: boolean;
        error?: string;
        sequence?: number;
      };
    };
    if (p.type === "data-lens_seed") {
      notices.push("Starting from the current lens.");
    } else if (p.type === "data-window_reapply") {
      notices.push(
        p.data?.start && p.data?.end
          ? `Regenerated the preview for ${formatWindowRange(p.data.start, p.data.end)}.`
          : "Regenerated the preview for the selected window.",
      );
    } else if (p.type === "data-refine_lint" && p.data?.match) {
      notices.push(
        `Heads up: the lens pins a fixed count (“${p.data.match}”), so it may drop content when the sources change.`,
      );
    } else if (p.type === "data-refine_error") {
      notices.push(
        p.data?.message ||
          "Generating the preview failed — send another message to retry.",
      );
    } else if (p.type === "data-refine_result") {
      if (p.data?.ok) {
        notices.push("Proposed an edit to the candidate document.");
      } else {
        notices.push(
          p.data?.error
            ? `Failed to propose edit: ${p.data.error}`
            : "Failed to propose edit.",
        );
      }
    } else if (p.type === REGENERATE_CONFIRM_PART_TYPE) {
      notices.push("Confirmed candidate regeneration.");
    } else if (p.type === REGENERATE_CANCEL_PART_TYPE) {
      notices.push("Cancelled candidate regeneration.");
    }
  }
  return notices;
}

const FABRICATED_TURN_PARTS = [
  "data-lens_seed",
  "data-window_reapply",
  REGENERATE_CONFIRM_PART_TYPE,
  REGENERATE_CONFIRMATION_PART_TYPE,
  CONTEXT_CONFIRMATION_PART_TYPE,
];

function toolNoticeFor(msg: UIMessage): string | null {
  if (
    msg.parts.some((p) =>
      FABRICATED_TURN_PARTS.includes((p as { type?: string }).type ?? ""),
    )
  ) {
    return null;
  }
  for (const part of msg.parts) {
    const p = part as { type?: string; toolName?: string };
    const name =
      p.type === "dynamic-tool"
        ? p.toolName
        : p.type?.startsWith("tool-")
          ? p.type.slice("tool-".length)
          : undefined;
    if (!name) continue;
    const notice = TOOL_MESSAGES[name];
    if (notice !== null) return notice ?? `Called ${name}.`;
  }
  return null;
}

export interface MessageActionsArgs {
  message: UIMessage;
  content: string;
  role: "user" | "assistant";
  /**
   * The turn is still in flight — the message has no persisted row yet (an
   * answer mid-stream, or the user message that just went out with it), so
   * anything that addresses it server-side has to wait.
   */
  pending: boolean;
}

interface RegenerateConfirmationCardProps {
  affectedEdits?: SnapshotEdit[];
  onConfirm?: () => void;
  onCancel?: () => void;
  isBusy?: boolean;
  isSettled?: boolean;
}

function RegenerateConfirmationCard({
  affectedEdits,
  onConfirm,
  onCancel,
  isBusy,
  isSettled,
}: RegenerateConfirmationCardProps) {
  const count = affectedEdits?.length ?? 0;
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-none border border-line bg-surface-2 p-3 space-y-2.5 text-body-sm">
        <div className="font-medium text-fg-1">Regenerate candidate draft?</div>
        <div className="text-fg-3 text-caption">
          {count > 0
            ? `This candidate has ${count} accepted edit${count > 1 ? "s" : ""}. Regenerating shows the new text as changes on the current draft; an accepted edit is kept only if the new text still contains its passage.`
            : "This candidate has accepted edits. Regenerating shows the new text as changes on the current draft; an accepted edit is kept only if the new text still contains its passage."}
        </div>
        {!isSettled && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="xs"
              variant="destructive"
              onClick={onConfirm}
              disabled={isBusy}
            >
              Regenerate anyway
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={onCancel}
              disabled={isBusy}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface ChatMessagesProps {
  messages: UIMessage[];
  greeting?: string;
  pending?: boolean;
  highlightedEditId?: string | null;
  edits?: SnapshotEdit[];
  onUndoEdit?: (editId: string) => void;
  onConfirmRegenerate?: () => void;
  onCancelRegenerate?: () => void;
  /** The user accepted a proposed context change: `items` are the new selection, labelled. */
  onConfirmContext?: (spec: ContextSpec, items: ContextItem[]) => void;
  onCancelContext?: () => void;
  /**
   * Controls to attach under each chat turn that carries text, either role —
   * e.g. bookmarking it. Omit to render a plain transcript.
   */
  messageActions?: (args: MessageActionsArgs) => ReactNode;
  /**
   * Which messages keep their actions visible rather than hover-revealed —
   * those whose state the reader should see at a glance.
   */
  actionsVisibleFor?: (message: UIMessage) => boolean;
}

export function ChatMessages({
  messages,
  greeting = "Hello! How can I help you today?",
  pending,
  highlightedEditId,
  edits,
  onUndoEdit,
  onConfirmRegenerate,
  onCancelRegenerate,
  onConfirmContext,
  onCancelContext,
  messageActions,
  actionsVisibleFor,
}: ChatMessagesProps) {
  // System messages carry no chat text. Those with a `context_spec` or
  // `window` part mark where the context / target window changed and render
  // as dividers at that position; the rest (`pinned_ids`) stay unrendered.
  const chatMessageCount = messages.filter((m) => m.role !== "system").length;
  let prevSpec: ContextSpec | null = null;
  let prevWindow: TimeWindow | null = null;
  // While a turn is in flight, everything from the user message that started
  // it onward has no row on the server yet.
  let inFlightFrom = -1;
  if (pending) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        inFlightFrom = i;
        break;
      }
    }
  }

  return (
    <>
      {chatMessageCount === 0 && (
        <div className="flex justify-start">
          <div className="max-w-[70%] rounded-none px-4 py-2.5 text-body-sm leading-relaxed whitespace-pre-wrap break-words bg-surface-2 text-fg-1">
            {greeting}
          </div>
        </div>
      )}
      {messages.map((msg, index) => {
        if (msg.role === "system") {
          const spec = messageContextSpec(msg);
          const win = messageWindow(msg);
          const editNotice = editNoticeFor(msg);
          const supersededNotice = supersededNoticeFor(msg);
          if (!spec && !win && !editNotice && !supersededNotice) return null;
          const before = prevSpec;
          if (spec) prevSpec = spec;
          const windowBefore = prevWindow;
          if (win) prevWindow = win;
          return (
            <Fragment key={msg.id}>
              {win && (
                <WindowDivider window={win} isFirst={windowBefore === null} />
              )}
              {spec && <ContextSpecDivider spec={spec} prevSpec={before} />}
              {editNotice && (
                <EditNoticeCard
                  notice={editNotice}
                  isHighlighted={Boolean(
                    highlightedEditId &&
                      editNotice.editId === highlightedEditId,
                  )}
                  liveEdit={
                    editNotice.editId && edits
                      ? edits.find((e) => e.id === editNotice.editId)
                      : undefined
                  }
                  onUndoEdit={onUndoEdit}
                  isBusy={pending}
                />
              )}
              {supersededNotice && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-none px-4 py-1.5 text-body-sm italic leading-relaxed text-fg-4">
                    {supersededNotice}
                  </div>
                </div>
              )}
            </Fragment>
          );
        }

        const hasText = msg.parts.some(
          (part) => part.type === "text" && part.text?.trim(),
        );
        const dataNotices =
          msg.role === "assistant"
            ? [...dataNoticesFor(msg), ...readNoticesFor(msg)]
            : [];
        const noticeRows = dataNotices.map((notice, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: notices are a pure derivation of the message's parts
          <div key={`${msg.id}-notice-${i}`} className="flex justify-start">
            <div className="max-w-[70%] rounded-none px-4 py-1.5 text-body-sm italic leading-relaxed text-fg-4">
              {notice}
            </div>
          </div>
        ));

        const confirmationPart = msg.parts.find(
          (p) =>
            (p as { type?: string }).type === REGENERATE_CONFIRMATION_PART_TYPE,
        ) as { data?: { affectedEdits?: SnapshotEdit[] } } | undefined;

        const contextConfirmation = (
          msg.parts.find(
            (p) =>
              (p as { type?: string }).type === CONTEXT_CONFIRMATION_PART_TYPE,
          ) as { data?: ContextConfirmation } | undefined
        )?.data;

        // A card is settled once a later message carries the user's answer.
        const settledBy = (...types: string[]) =>
          messages
            .slice(index + 1)
            .some((m) =>
              m.parts?.some((p) =>
                types.includes((p as { type?: string }).type ?? ""),
              ),
            );
        const isSettled = settledBy(
          REGENERATE_CONFIRM_PART_TYPE,
          REGENERATE_CANCEL_PART_TYPE,
        );
        const contextSettled = settledBy(
          CONTEXT_CONFIRM_PART_TYPE,
          CONTEXT_CANCEL_PART_TYPE,
        );

        const cards = (
          <>
            {confirmationPart && (
              <RegenerateConfirmationCard
                affectedEdits={confirmationPart.data?.affectedEdits}
                onConfirm={onConfirmRegenerate}
                onCancel={onCancelRegenerate}
                isBusy={pending}
                isSettled={isSettled}
              />
            )}
            {contextConfirmation?.spec && (
              <ContextConfirmationCard
                confirmation={contextConfirmation}
                prevSpec={prevSpec}
                onConfirm={onConfirmContext}
                onCancel={onCancelContext}
                isBusy={pending}
                isSettled={contextSettled}
              />
            )}
          </>
        );

        if (!hasText) {
          const notice = toolNoticeFor(msg);
          if (
            !notice &&
            noticeRows.length === 0 &&
            !confirmationPart &&
            !contextConfirmation
          )
            return null;
          return (
            <Fragment key={msg.id}>
              {notice && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-none px-4 py-2.5 text-body-sm italic leading-relaxed text-fg-4 bg-surface-2">
                    {notice}
                  </div>
                </div>
              )}
              {cards}
              {noticeRows}
            </Fragment>
          );
        }

        // A summaries-mode turn can carry text on both sides of its reads.
        const content = msg.parts
          .filter((part) => part.type === "text" && part.text?.trim())
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n\n");

        const role = msg.role === "user" ? "user" : "assistant";
        const actionArgs: MessageActionsArgs | null = messageActions
          ? {
              message: msg,
              content,
              role,
              pending: inFlightFrom >= 0 && index >= inFlightFrom,
            }
          : null;
        return (
          <Fragment key={msg.id}>
            <MessageBubble
              role={msg.role}
              content={content}
              actions={actionArgs ? messageActions?.(actionArgs) : undefined}
              actionsVisible={actionsVisibleFor?.(msg)}
            />
            {cards}
            {noticeRows}
          </Fragment>
        );
      })}

      {pending && (
        <div className="flex justify-start">
          <div className="bg-surface-2 rounded-none px-4 py-2.5 text-body-sm text-fg-4">
            …
          </div>
        </div>
      )}
    </>
  );
}
