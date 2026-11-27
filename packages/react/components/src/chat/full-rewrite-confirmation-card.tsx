import type { FullRewriteConfirmation } from "@kalaido/client/kalaidoscope/chat";
import { Button } from "@kalaido/primitives/shadcn/button";

export interface FullRewriteConfirmationCardProps {
  confirmation: FullRewriteConfirmation;
  onConfirm?: () => void;
  onCancel?: () => void;
  isBusy?: boolean;
  isSettled?: boolean;
}

export function FullRewriteConfirmationCard({
  confirmation,
  onConfirm,
  onCancel,
  isBusy,
  isSettled,
}: FullRewriteConfirmationCardProps) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-none border border-line bg-surface-2 p-3 space-y-2.5 text-body-sm">
        <div className="font-medium text-fg-1">Replace the full draft?</div>
        {confirmation.reason && (
          <div className="text-fg-2">{confirmation.reason}</div>
        )}
        {typeof confirmation.changedPercent === "number" &&
          confirmation.changedPercent > 0 && (
            <div className="font-mono text-mono-sm text-fg-4">
              ~{confirmation.changedPercent}% of blocks changed
            </div>
          )}
        {!isSettled && (
          <div className="flex items-center gap-2 pt-1">
            <Button size="xs" onClick={onConfirm} disabled={isBusy}>
              Replace draft
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={onCancel}
              disabled={isBusy}
            >
              Keep current draft
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
