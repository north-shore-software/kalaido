import { cn } from "@kalaido/primitives/lib/css-utils";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Input } from "@kalaido/primitives/shadcn/input";
import {
  CADENCE_DAYS,
  CADENCES,
  countGridWindows,
  dateInputToEndTime,
  dateInputToStartTime,
  describeRecurrence,
  toDateInputValue,
} from "../schedule";
import { CadenceChips, PauseScheduleControl } from "./schedule-controls";

export interface RefineConfigPanelProps {
  cadence: number;
  onCadenceChange: (cadence: number) => void;
  /** "Starting from" as a date input value (YYYY-MM-DD, local). */
  fromDate: string;
  onFromDateChange: (date: string) => void;
  fromDisabled?: boolean;
  /** Shown under the date in place of the backfill count, e.g. why it is fixed. */
  fromNote?: string;
  /** Optional "End date" (YYYY-MM-DD, local) for bounded historical reflections. */
  endDate: string;
  onEndDateChange: (date: string) => void;
  /** When true, automatic forward window generation is paused. */
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  className?: string;
}

export function RefineConfigPanel({
  cadence,
  onCadenceChange,
  fromDate,
  onFromDateChange,
  fromDisabled,
  fromNote,
  endDate,
  onEndDateChange,
  paused,
  onPausedChange,
  className,
}: RefineConfigPanelProps) {
  const startTime = dateInputToStartTime(fromDate);
  const endTime = dateInputToEndTime(endDate);
  const historicalCount = countGridWindows(
    startTime,
    CADENCE_DAYS[cadence],
    undefined,
    endTime,
  );

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
          {describeRecurrence(cadence, startTime, undefined, endTime, paused)}
        </p>
        {fromNote ? (
          <p className="text-meta text-fg-4">{fromNote}</p>
        ) : (
          !paused &&
          historicalCount > 0 && (
            <p className="text-meta text-fg-4">
              {`Will generate ${historicalCount} ${CADENCES[cadence].toLowerCase()} ${historicalCount === 1 ? "summary" : "summaries"}${endDate ? " in that range" : " back to that date"} once you finish.`}
            </p>
          )
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="reflection-end"
            className="text-label font-semibold uppercase text-fg-3"
          >
            End date (optional)
          </label>
          {endDate && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onEndDateChange("")}
            >
              Clear
            </Button>
          )}
        </div>
        <Input
          id="reflection-end"
          type="date"
          value={endDate}
          min={fromDate || undefined}
          onValueChange={onEndDateChange}
          aria-label="End date"
        />
        <p className="text-meta text-fg-4">
          Leave blank to keep running, or set an end date for a bounded
          historical archive.
        </p>
      </div>

      <PauseScheduleControl paused={paused} onChange={onPausedChange} />
    </div>
  );
}
