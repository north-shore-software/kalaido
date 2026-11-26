import { getActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { isArchived } from "@kalaido/client/lib/active-kalaidoscopes";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { KalaidoscopeClientContext } from "@kalaido/hooks/use-kalaidoscope-client";
import { Label, StatusPill } from "@kalaido/primitives/kalaido";
import { SectionHeader } from "@kalaido/primitives/layout/section";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { allKalaidoscopes, DesktopScopeContext } from "@/state/app-state.ts";
import { KalaidoscopeRow } from "./kalaidoscope-row";
import { WorkspaceAiPanel } from "./workspace-ai-panel";
import { WorkspaceBackupsPanel } from "./workspace-backups-panel";
import { WorkspaceQuotaPanel } from "./workspace-quota-panel";

export function KalaidoscopesSection() {
  const root = useScopeContext(DesktopScopeContext);
  const sectionScope = useScope({
    from: root,
    state: ["appStage", "localKalaidoscopes", "cachedCloudKalaidoscopes"],
  });
  const { appStage, localKalaidoscopes, cachedCloudKalaidoscopes } =
    useScopeState(sectionScope);
  const kalaidoscopes = allKalaidoscopes({
    localKalaidoscopes,
    cachedCloudKalaidoscopes,
  });
  const currentKalaidoscopeId =
    appStage.stage === "kalaidoscope_open"
      ? appStage.selectedKalaidoscopeId
      : null;
  const switching = appStage.stage === "kalaidoscope_loading";
  const active = kalaidoscopes.find((k) => k.id === currentKalaidoscopeId);
  const activeClient = active ? getActiveKalaidoscopeClient() : null;
  const others = kalaidoscopes.filter(
    (k) => k.id !== currentKalaidoscopeId && !isArchived(k),
  );
  const archived = kalaidoscopes.filter(isArchived);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Manage Kalaidoscopes"
        description="All kalaidoscopes stored in this application."
      />
      {active && (
        <KalaidoscopeRow kalaidoscope={active} isActive>
          {activeClient && (
            <KalaidoscopeClientContext.Provider
              key={active.id}
              value={activeClient}
            >
              <WorkspaceAiPanel kalaidoscope={active} />
              <WorkspaceQuotaPanel kalaidoscope={active} />
              <WorkspaceBackupsPanel kalaidoscope={active} />
            </KalaidoscopeClientContext.Provider>
          )}
        </KalaidoscopeRow>
      )}
      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <Label>Other scopes</Label>
            <StatusPill>{others.length}</StatusPill>
          </div>
          {others.map((kalaidoscope) => (
            <KalaidoscopeRow
              key={kalaidoscope.id}
              kalaidoscope={kalaidoscope}
              isActive={false}
              switching={switching}
            />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <Label>Archived</Label>
            <StatusPill>{archived.length}</StatusPill>
          </div>
          {archived.map((kalaidoscope) => (
            <KalaidoscopeRow
              key={kalaidoscope.id}
              kalaidoscope={kalaidoscope}
              isActive={false}
              switching={switching}
            />
          ))}
        </div>
      )}
    </div>
  );
}
