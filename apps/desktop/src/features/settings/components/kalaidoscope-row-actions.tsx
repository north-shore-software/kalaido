import { Button } from "@kalaido/primitives/shadcn/button";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";

export interface KalaidoscopeRowActionsProps {
  isActive: boolean;
  isCloud: boolean;
  archived: boolean;
  switching?: boolean;
  removing: boolean;
  confirming: boolean;
  onSwitch: () => void;
  onUnarchive: () => void;
  onConfirmRemove: () => void;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
}

export function KalaidoscopeRowActions({
  isActive,
  isCloud,
  archived,
  switching,
  removing,
  confirming,
  onSwitch,
  onUnarchive,
  onConfirmRemove,
  onRequestConfirm,
  onCancelConfirm,
}: KalaidoscopeRowActionsProps) {
  const showSwitch = !isActive && !archived;
  const confirmLabel = isCloud ? "Yes, archive" : "Yes, remove";
  const actionLabel = isCloud ? "Archive" : "Remove";

  return (
    <>
      {showSwitch && (
        <Button disabled={switching || removing} onClick={onSwitch}>
          Switch to
        </Button>
      )}
      {archived ? (
        <Button variant="outline" disabled={removing} onClick={onUnarchive}>
          {removing ? <Spinner /> : "Unarchive"}
        </Button>
      ) : confirming ? (
        <>
          <Button
            variant="destructive"
            disabled={removing}
            onClick={onConfirmRemove}
          >
            {removing ? <Spinner /> : confirmLabel}
          </Button>
          <Button variant="ghost" disabled={removing} onClick={onCancelConfirm}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          variant="destructive"
          disabled={switching || removing}
          onClick={onRequestConfirm}
        >
          {actionLabel}
        </Button>
      )}
    </>
  );
}
