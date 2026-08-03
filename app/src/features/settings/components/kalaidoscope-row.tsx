import { Pill, SurfaceCard } from "@/components/kalaido";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";

export function KalaidoscopeRow({
  kalaidoscope,
  isActive,
}: {
  kalaidoscope: KalaidoscopeMeta;
  isActive: boolean;
}) {
  return (
    <SurfaceCard className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{kalaidoscope.displayName}</span>
        {isActive && <Pill>active</Pill>}
      </div>
    </SurfaceCard>
  );
}
