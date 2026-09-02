import { useCallback, useEffect, useState } from "react";
import type { TimeWindow } from "@/api/kalaidoscope/chat";
import {
  listReflectionWindows,
  type ReflectionWindow,
} from "@/api/kalaidoscope/reflections";
import { Label } from "@/components/kalaido";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { formatWindowRange } from "@/lib/datetime";

/**
 * Which window the refine chat targets. Lists the reflection's series (oldest
 * first) plus the window the conversation is currently bound to when it is
 * not on the grid (the trailing "as of now" window of a brand-new reflection).
 * Picking one re-targets the chat on its next send. `refreshKey` re-fetches
 * the list — bump it when the schedule or the snapshots change.
 */
export function WindowSelect({
  reflectionId,
  active,
  onChange,
  refreshKey,
  className,
}: {
  reflectionId: string;
  active: TimeWindow | undefined;
  onChange: (win: TimeWindow) => void;
  refreshKey?: unknown;
  className?: string;
}) {
  const [windows, setWindows] = useState<ReflectionWindow[]>([]);

  const load = useCallback(async () => {
    const res = await listReflectionWindows(reflectionId);
    if (res.isOk()) setWindows(res.value.windows);
  }, [reflectionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an explicit re-fetch trigger
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const activeKey = active ? `${active.start}_${active.end}` : "";
  const onGrid = windows.some((w) => w.key === activeKey);
  if (windows.length === 0 && !active) return null;

  const mark = (w: ReflectionWindow) =>
    w.generating ? " · generating" : w.hasApproved ? "" : " · no summary yet";

  return (
    <div className={className}>
      <Label>Window</Label>
      <NativeSelect
        size="sm"
        className="w-full"
        value={activeKey}
        onChange={(e) => {
          const key = e.target.value;
          const picked = windows.find((w) => w.key === key);
          if (picked) onChange({ id: picked.id, start: picked.start, end: picked.end });
        }}
      >
        {active && !onGrid && (
          <NativeSelectOption value={activeKey}>
            {formatWindowRange(active.start, active.end)} · as of now
          </NativeSelectOption>
        )}
        {[...windows].reverse().map((w) => (
          <NativeSelectOption key={w.key} value={w.key}>
            {formatWindowRange(w.start, w.end)}
            {mark(w)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
