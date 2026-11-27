import { Label } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { PencilSimpleIcon } from "@phosphor-icons/react";

export interface StandingLensCardProps {
  lensPrompt: string;
  canEdit: boolean;
  onEdit: () => void;
}

/**
 * Compact read-only preview of the active standing lens inside the refine
 * screen's config rail, with a direct edit button so users can inspect or edit
 * the standing prompt without forcing a chat turn.
 */
export function StandingLensCard({
  lensPrompt,
  canEdit,
  onEdit,
}: StandingLensCardProps) {
  return (
    <div className="flex flex-col gap-2 border border-line bg-surface-1 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Standing lens</Label>
        {canEdit && (
          <Button size="xs" variant="outline" onClick={onEdit}>
            <PencilSimpleIcon />
            Edit
          </Button>
        )}
      </div>
      {lensPrompt ? (
        <p className="line-clamp-5 whitespace-pre-wrap text-meta text-fg-2">
          {lensPrompt}
        </p>
      ) : (
        <p className="text-meta text-fg-4">
          No standing lens yet — describe what you want in chat, or edit
          directly once created.
        </p>
      )}
    </div>
  );
}
