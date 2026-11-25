import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import { kalaidoscopeTypeLabel } from "@kalaido/client/lib/labels";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { ListRow } from "@kalaido/primitives/kalaido";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { allKalaidoscopes, DesktopScopeContext } from "@/state/app-state.ts";

interface KalaidoscopeListProps {
  excludeId?: string;
  className?: string;
  onSwitched?: () => void;
}

export function KalaidoscopeList({
  excludeId,
  className,
  onSwitched,
}: KalaidoscopeListProps) {
  const root = useScopeContext(DesktopScopeContext);
  const listScope = useScope({
    from: root,
    state: ["appStage", "localKalaidoscopes", "cachedCloudKalaidoscopes"],
  });
  const { appStage, localKalaidoscopes, cachedCloudKalaidoscopes } =
    useScopeState(listScope);
  const switching = appStage.stage === "kalaidoscope_loading";
  const items = activeKalaidoscopes(
    allKalaidoscopes({ localKalaidoscopes, cachedCloudKalaidoscopes }),
  ).filter((k) => k.id !== excludeId);

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
            <div className="flex size-7 shrink-0 items-center justify-center rounded-none border">
              <span className="text-meta font-medium">
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
