import { ClockIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Chip, Label, Mono } from "@/components/kalaido";
import { FREQ, WIN } from "@/features/reflections/schedule";
import { cn } from "@/lib/css-utils";

export interface ScheduleChipsProps {
  freq: number;
  win: number;
  onChangeFreq: (freq: number) => void;
  onChangeWin: (win: number) => void;
  freqLabel?: ReactNode;
  winLabel?: ReactNode;
  gap?: string;
}

export function ScheduleChips({
  freq,
  win,
  onChangeFreq,
  onChangeWin,
  freqLabel = "Frequency",
  winLabel = "Lookback",
  gap = "gap-1.5",
}: ScheduleChipsProps) {
  return (
    <>
      <div className={cn("flex flex-col", gap)}>
        <Label>{freqLabel}</Label>
        <div className="flex flex-wrap gap-1.5">
          {FREQ.map((f, i) => (
            <Chip key={f} active={i === freq} onClick={() => onChangeFreq(i)}>
              {f}
            </Chip>
          ))}
        </div>
      </div>
      <div className={cn("flex flex-col", gap)}>
        <Label>{winLabel}</Label>
        <div className="flex flex-wrap gap-1.5">
          {WIN.map((w, i) => (
            <Chip key={w} active={i === win} onClick={() => onChangeWin(i)}>
              {w}
            </Chip>
          ))}
        </div>
      </div>
    </>
  );
}

export interface SchedulePillProps {
  freq: string;
  win: string;
  className?: string;
}

export function SchedulePill({ freq, win, className }: SchedulePillProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-none bg-surface-2 p-2.5",
        className,
      )}
    >
      <ClockIcon className="size-3.5 text-fg-3" />
      <Mono className="text-meta text-fg-2">
        {freq} · last {win}
      </Mono>
    </div>
  );
}
