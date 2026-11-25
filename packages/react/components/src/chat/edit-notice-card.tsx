import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import { EditDiffBoxes } from "@kalaido/primitives/kalaido/edit-diff-boxes";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@kalaido/primitives/shadcn/tooltip";
import {
  ArrowUUpLeftIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  PencilSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { MarkdownContent } from "../markdown-content";
import {
  type DescribedEditNotice,
  describeEditNotice,
  type EditNoticeIconKind,
  type SystemEditNotice,
} from "./edit-notice";

export interface EditNoticeCardProps {
  notice: SystemEditNotice;
  isHighlighted?: boolean;
  liveEdit?: SnapshotEdit;
  onUndoEdit?: (editId: string) => void;
  isBusy?: boolean;
}

function EditNoticeIcon({ kind }: { kind: EditNoticeIconKind }) {
  switch (kind) {
    case "hand_edit":
      return <PencilSimpleIcon className="size-3 shrink-0 text-fg-4" />;
    case "refine_target":
      return <ChatCircleDotsIcon className="size-3 shrink-0 text-fg-4" />;
    case "approved":
      return <CheckIcon className="size-3 shrink-0 text-stable" />;
    case "rejected":
      return <XIcon className="size-3 shrink-0 text-critical" />;
    case "proposed":
      return <ArrowUUpLeftIcon className="size-3 shrink-0 text-fg-3" />;
    default:
      return null;
  }
}

function EditNoticeUndoControl({
  isUndoable,
  isBusy,
  undoReason,
  onUndo,
}: {
  isUndoable: boolean;
  isBusy?: boolean;
  undoReason?: string;
  onUndo: () => void;
}) {
  if (isUndoable) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onUndo}
        className="h-6 gap-1 px-2 text-xs font-sans text-fg-2 hover:bg-surface-3 cursor-pointer"
      >
        <ArrowUUpLeftIcon className="size-3" />
        Undo
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // aria-disabled rather than disabled: a disabled button is
          // unfocusable and unhoverable, which would hide the tooltip that
          // explains why Undo is unavailable.
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
  );
}

function EditNoticeBody({
  notice,
  described,
}: {
  notice: SystemEditNotice;
  described: DescribedEditNotice;
}) {
  return (
    <div className="space-y-2 p-3 text-body-sm">
      {notice.kind === "hand_edit" && (
        <EditDiffBoxes
          before={notice.before}
          after={notice.after}
          variant="chat"
        />
      )}
      {notice.kind === "refine_target" && notice.passage && (
        <div className="rounded-none border-l-2 border-line-focus bg-surface-1 px-3 py-2 italic text-fg-2">
          <MarkdownContent variant="chat" content={notice.passage} />
        </div>
      )}
      {described.fallbackRawText && (
        <div className="font-mono whitespace-pre-wrap text-fg-3">
          {described.fallbackRawText}
        </div>
      )}
      {notice.kind === "triage" && (
        <p className="text-meta text-fg-3">{described.triageText}</p>
      )}
    </div>
  );
}

export function EditNoticeCard({
  notice,
  isHighlighted,
  liveEdit,
  onUndoEdit,
  isBusy,
}: EditNoticeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  const described = describeEditNotice(notice, liveEdit);

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
          <EditNoticeIcon kind={described.iconKind} />
          <span className="font-mono text-fg-2">{described.label}</span>
        </div>
        {described.canUndo && (
          <div>
            <EditNoticeUndoControl
              isUndoable={described.isUndoable}
              isBusy={isBusy}
              undoReason={described.undoReason}
              onUndo={() => notice.editId && onUndoEdit?.(notice.editId)}
            />
          </div>
        )}
      </div>
      <EditNoticeBody notice={notice} described={described} />
    </div>
  );
}
