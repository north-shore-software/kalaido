import {
  ArrowUpRightIcon,
  ChatCircleDotsIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type {
  SnapshotEdit,
  SnapshotEditStatus,
} from "@/api/kalaidoscope/projections";
import { MarkdownContent } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { parseEditMarker, segmentBlockRanges } from "@/lib/markdown-diff";
import { EditCandidateModal } from "./edit-candidate-modal";
import { SnapshotEditCard } from "./snapshot-edit-card";

export interface ProjectionCanvasProps {
  content?: string;
  draftContent?: string;
  edits?: SnapshotEdit[];
  pending?: boolean;
  onEditStatusChange?: (editId: string, status: SnapshotEditStatus) => void;
  onHandEdit?: (blockPosition: number, newText: string) => Promise<void>;
  onRefineEdit?: (edit: SnapshotEdit) => void;
  onRefinePassage?: (passage: string) => void;
  onJumpToChatEvent?: (editId: string) => void;
  activeEditId?: string | null;
  busy?: boolean;
  /**
   * The candidate is stale (an outdated-candidate gate is up): no new hand
   * edits or refinements on it, but proposals already on it can still be
   * accepted or rejected — folding in needs every one of them decided.
   */
  frozen?: boolean;
  className?: string;
}

export function ProjectionCanvas({
  content,
  draftContent,
  edits = [],
  pending = false,
  onEditStatusChange,
  onHandEdit,
  onRefineEdit,
  onRefinePassage,
  onJumpToChatEvent,
  activeEditId,
  busy = false,
  frozen = false,
  className,
}: ProjectionCanvasProps) {
  const [selectedBlock, setSelectedBlock] = useState<{
    index: number;
    text: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string>();

  const baseText = pending ? (draftContent ?? content ?? "") : (content ?? "");
  const blocks = useMemo(() => segmentBlockRanges(baseText), [baseText]);

  const approvedEditsByBlock = useMemo(() => {
    const map: Record<number, SnapshotEdit[]> = {};
    for (const edit of edits) {
      if (edit.status === "approved" && edit.type !== "regeneration") {
        const targetBlockIdx = blocks.findIndex((b) =>
          edit.contentAfter ? b.text.includes(edit.contentAfter.trim()) : false,
        );
        const idx = targetBlockIdx !== -1 ? targetBlockIdx : edit.blockIndex;
        if (!map[idx]) map[idx] = [];
        map[idx].push(edit);
      }
    }
    return map;
  }, [edits, blocks]);

  const editsById = useMemo(() => {
    const map = new Map<string, SnapshotEdit>();
    for (const edit of edits) {
      map.set(edit.id, edit);
    }
    return map;
  }, [edits]);

  async function handleApplyEdit(newText: string) {
    if (!selectedBlock || !onHandEdit) return;
    setSavingEdit(true);
    setEditError(undefined);
    try {
      await onHandEdit(selectedBlock.index, newText);
      setSelectedBlock(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  }

  if (!baseText.trim() && edits.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-fg-3">
        No document content to display
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-4">
        {blocks.map((block, idx) => {
          const markerEditId = parseEditMarker(block.text);
          if (markerEditId) {
            const edit = editsById.get(markerEditId);
            if (edit) {
              return (
                <SnapshotEditCard
                  key={edit.id}
                  edit={edit}
                  disabled={busy}
                  refineDisabled={frozen}
                  isActive={edit.id === activeEditId}
                  onStatusChange={(status) =>
                    onEditStatusChange?.(edit.id, status)
                  }
                  onRefine={onRefineEdit}
                />
              );
            }
          }

          const approvedForBlock = approvedEditsByBlock[idx] ?? [];

          return (
            <div
              key={block.start}
              className="group relative rounded-none p-1.5 transition-colors hover:bg-surface-2/40"
            >
              <MarkdownContent content={block.text} />
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                {approvedForBlock.map((edit) => (
                  <button
                    key={edit.id}
                    type="button"
                    onClick={() => onJumpToChatEvent?.(edit.id)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-none border border-stable/40 bg-surface-1/90 px-1.5 py-0.5 font-mono text-[10px] text-stable hover:border-stable hover:bg-stable-wash/20"
                    title={`Jump to edit #${edit.sequence} in chat`}
                  >
                    <span>Edit #{edit.sequence}</span>
                    <ArrowUpRightIcon className="size-2.5" />
                  </button>
                ))}
                {pending && onHandEdit && !busy && !frozen && (
                  <div className="hidden items-center gap-1 bg-surface-1/90 px-1 py-0.5 shadow-xs group-hover:flex">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="h-6 gap-1 px-1.5 text-xs"
                      onClick={() =>
                        setSelectedBlock({ index: idx, text: block.text })
                      }
                    >
                      <PencilSimpleIcon className="size-3" />
                      Edit
                    </Button>
                    {onRefinePassage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        className="h-6 gap-1 px-1.5 text-xs"
                        onClick={() => onRefinePassage(block.text)}
                      >
                        <ChatCircleDotsIcon className="size-3" />
                        Refine
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedBlock && (
        <EditCandidateModal
          open={!!selectedBlock}
          oldText={selectedBlock.text}
          saving={savingEdit}
          error={editError}
          onClose={() => setSelectedBlock(null)}
          onSubmit={handleApplyEdit}
        />
      )}
    </div>
  );
}
