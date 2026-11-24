import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import type { StageError } from "@kalaido/client/lib/errors";
import { RecoveryView } from "@kalaido/components/recovery-view";
import { useSnapshot } from "valtio/react";
import { KalaidoscopeList } from "@/features/create-kalaidoscope/components/kalaidoscope-list";
import { appState } from "@/hooks/use-app-state";

export interface RecoveryScreenProps {
  title: string;
  description: string;
  error?: StageError | null;
  onRetry?: () => void;
  retryLabel?: string;
  allowSwitch?: boolean;
  excludeKalaidoscopeId?: string;
  onSwitched?: () => void;
}

export function RecoveryScreen({
  title,
  description,
  error,
  onRetry,
  retryLabel = "Try again",
  allowSwitch = false,
  excludeKalaidoscopeId,
  onSwitched,
}: RecoveryScreenProps) {
  const { availableKalaidoscopes } = useSnapshot(appState);

  const showSwitcher =
    allowSwitch &&
    activeKalaidoscopes(availableKalaidoscopes).some(
      (k) => k.id !== excludeKalaidoscopeId,
    );

  return (
    <RecoveryView
      title={title}
      description={description}
      error={error}
      onRetry={onRetry}
      retryLabel={retryLabel}
      resetNotice="Clears all saved kalaidoscopes, preferences, and app state, then restarts. Kalaidoscope data directories on disk are not deleted."
      footer={
        showSwitcher ? (
          <div className="flex flex-col gap-2 border-t pt-5">
            <span className="text-label uppercase text-muted-foreground">
              Open a different kalaidoscope
            </span>
            <KalaidoscopeList
              className="flex flex-col"
              excludeId={excludeKalaidoscopeId}
              onSwitched={onSwitched}
            />
          </div>
        ) : undefined
      }
    />
  );
}
