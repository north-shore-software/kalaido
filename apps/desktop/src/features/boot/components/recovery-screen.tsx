import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import type { StageError } from "@kalaido/client/lib/errors";
import { RecoveryView } from "@kalaido/components/recovery-view";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { KalaidoscopeList } from "@/features/create-kalaidoscope/components/kalaidoscope-list";
import {
  allKalaidoscopes,
  DesktopScopeContext,
  prepareDesktopReset,
} from "@/state/app-state";

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
  const root = useScopeContext(DesktopScopeContext);
  const listScope = useScope({
    from: root,
    state: ["localKalaidoscopes", "cachedCloudKalaidoscopes"],
  });
  const { localKalaidoscopes, cachedCloudKalaidoscopes } =
    useScopeState(listScope);

  const showSwitcher =
    allowSwitch &&
    activeKalaidoscopes(
      allKalaidoscopes({ localKalaidoscopes, cachedCloudKalaidoscopes }),
    ).some((k) => k.id !== excludeKalaidoscopeId);

  return (
    <RecoveryView
      title={title}
      description={description}
      error={error}
      onRetry={onRetry}
      retryLabel={retryLabel}
      onBeforeClear={prepareDesktopReset}
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
