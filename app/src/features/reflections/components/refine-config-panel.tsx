import { Input } from "@/components/ui/input";
import { CadenceChips } from "@/features/reflections/components/schedule-controls";
import {
  CADENCE_DAYS,
  CADENCES,
  countGridWindows,
  dateInputToStartTime,
  describeRecurrence,
  toDateInputValue,
} from "@/features/reflections/schedule";
import { cn } from "@/lib/css-utils";

export interface RefineConfigPanelProps {
  cadence: number;
  onCadenceChange: (cadence: number) => void;
  /** "Starting from" as a date input value (YYYY-MM-DD, local). */
  fromDate: string;
  onFromDateChange: (date: string) => void;
  fromDisabled?: boolean;
  /** Shown under the date in place of the backfill count, e.g. why it is fixed. */
  fromNote?: string;
  className?: string;
}

export function RefineConfigPanel({
  cadence,
  onCadenceChange,
  fromDate,
  onFromDateChange,
  fromDisabled,
  fromNote,
  className,
}: RefineConfigPanelProps) {
  const startTime = dateInputToStartTime(fromDate);
  const historicalCount = countGridWindows(startTime, CADENCE_DAYS[cadence]);
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <CadenceChips cadence={cadence} onChange={onCadenceChange} gap="gap-2" />
      <div className="flex flex-col gap-2">
        <label
          htmlFor="reflection-from"
          className="text-label font-semibold uppercase text-fg-3"
        >
          Starting from
        </label>
        <Input
          id="reflection-from"
          type="date"
          value={fromDate}
          max={toDateInputValue(new Date())}
          onValueChange={onFromDateChange}
          disabled={fromDisabled}
          aria-label="Starting from date"
        />
        <p className="text-meta text-fg-4">
          {describeRecurrence(cadence, startTime)}
        </p>
        {fromNote ? (
          <p className="text-meta text-fg-4">{fromNote}</p>
        ) : (
          historicalCount > 0 && (
            <p className="text-meta text-fg-4">
              {`Will generate ${historicalCount} ${CADENCES[cadence].toLowerCase()} ${historicalCount === 1 ? "summary" : "summaries"} back to that date once you finish.`}
            </p>
          )
        )}
      </div>
    </div>
  );
}
