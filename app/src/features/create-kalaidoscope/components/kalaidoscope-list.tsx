import { useSnapshot } from "valtio/react";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { ListRow } from "@/components/kalaido";
import { appState } from "@/hooks/use-app-state.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";

interface KalaidoscopeListProps {
  excludeId?: string;
  className?: string;
  onSwitched?: () => void;
}

export function kalaidoscopeTypeLabel(type: KalaidoscopeMeta["type"]): string {
  switch (type) {
    case "local_file":
      return "On this device";
    case "cloud":
      return "Kalaido Cloud";
    case "local_net":
      return "Local network";
  }
}

export function KalaidoscopeList({
  excludeId,
  className,
  onSwitched,
}: KalaidoscopeListProps) {
  const { appStage, availableKalaidoscopes } = useSnapshot(appState);
  const switching = appStage.stage === "kalaidoscope_loading";
  const items = availableKalaidoscopes.filter((k) => k.id !== excludeId);

  async function handleSelect(id: string) {
    await switchLocalKalaidoscope(id);
    onSwitched?.();
  }

  if (items.length === 0) return null;

  return (
    <div className={className}>
      {items.map((kalaidoscope) => (
        <ListRow
          key={kalaidoscope.id}
          leading={
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border">
              <span className="text-xs font-medium">
                {kalaidoscope.displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          }
          title={kalaidoscope.displayName}
          subtitle={kalaidoscopeTypeLabel(kalaidoscope.type)}
          onClick={
            switching ? undefined : () => void handleSelect(kalaidoscope.id)
          }
        />
      ))}
    </div>
  );
}
