import { useSnapshot } from "valtio/react";
import { Label, StatusPill } from "@/components/kalaido";
import { SectionHeader } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { appState } from "@/hooks/use-app-state.ts";
import { KalaidoscopeRow } from "./kalaidoscope-row";

export function KalaidoscopesSection() {
  const { appStage, availableKalaidoscopes: kalaidoscopes } =
    useSnapshot(appState);
  const currentKalaidoscopeId =
    appStage.stage === "kalaidoscope_open"
      ? appStage.selectedKalaidoscopeId
      : null;
  const switching = appStage.stage === "kalaidoscope_loading";
  const active = kalaidoscopes.find((k) => k.id === currentKalaidoscopeId);
  const others = kalaidoscopes.filter((k) => k.id !== currentKalaidoscopeId);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Manage Kalaidoscopes"
        description="All kalaidoscopes stored in this application."
      />
      {active && (
        <div className="flex flex-col gap-3">
          <KalaidoscopeRow kalaidoscope={active} isActive />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled>
              In-scope configurations
            </Button>
            <Button size="sm" disabled>
              PocketBase schema &amp; backups
            </Button>
          </div>
        </div>
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
    </div>
  );
}
