import { useSnapshot } from "valtio/react";
import { SectionHeader } from "@/components/layout/section";
import { appState } from "@/hooks/use-app-state.ts";
import { KalaidoscopeRow } from "./kalaidoscope-row";

export function KalaidoscopesSection() {
  const { appStage, availableKalaidoscopes: kalaidoscopes } =
    useSnapshot(appState);
  const currentKalaidoscopeId =
    appStage.stage === "kalaidoscope_open"
      ? appStage.selectedKalaidoscopeId
      : null;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Manage Kalaidoscopes"
        description="All kalaidoscopes stored in this application."
      />
      <div className="flex flex-col gap-3">
        {kalaidoscopes.map((kalaidoscope) => (
          <KalaidoscopeRow
            key={kalaidoscope.id}
            kalaidoscope={kalaidoscope}
            isActive={kalaidoscope.id === currentKalaidoscopeId}
          />
        ))}
      </div>
    </div>
  );
}
