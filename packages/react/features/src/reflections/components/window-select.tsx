import type { TimeWindow } from "@kalaido/client/kalaidoscope/chat";
import type { ReflectionWindow } from "@kalaido/client/kalaidoscope/reflections";
import { formatWindowRange } from "@kalaido/client/lib/datetime";
import { Label } from "@kalaido/primitives/kalaido";
import {
  NativeSelect,
  NativeSelectOption,
} from "@kalaido/primitives/shadcn/native-select";
import { useReflectionWindows } from "../hooks/use-reflection-windows";

/**
 * Which window the refine chat targets. Lists the reflection's series (oldest
 * first) plus the window the conversation is currently bound to when it is
 * not on the grid (the trailing "as of now" window of a brand-new reflection).
 * Picking one re-targets the chat on its next send.
 */
export function WindowSelect({
  reflectionId,
  active,
  onChange,
  className,
  compact,
}: {
  reflectionId: string;
  active: TimeWindow | undefined;
  onChange: (win: TimeWindow) => void;
  className?: string;
  /** No label, fits a pane header. */
  compact?: boolean;
}) {
  const { windows } = useReflectionWindows(reflectionId);

  const activeKey = active ? `${active.start}_${active.end}` : "";
  const onGrid = windows.some((w) => w.key === activeKey);
  if (windows.length === 0 && !active) return null;

  const mark = (w: ReflectionWindow) =>
    w.generating ? " · generating" : w.hasApproved ? "" : " · no summary yet";

  return (
    <div className={className}>
      {!compact && <Label>Window</Label>}
      <NativeSelect
        size="sm"
        className={compact ? "max-w-[200px]" : "w-full"}
        aria-label="Preview window"
        value={activeKey}
        onChange={(e) => {
          const key = e.target.value;
          const picked = windows.find((w) => w.key === key);
          if (picked)
            onChange({ id: picked.id, start: picked.start, end: picked.end });
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
