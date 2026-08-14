import { useId } from "react";
import { cn } from "@/lib/css-utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Pill, surfaceCardClass } from "@/components/kalaido";
import { RECOMMENDED_MODEL } from "@/api/kalaidoscope/llm-config";

function formatModelSize(bytes: number): string {
  if (!bytes) return "";
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export interface LocalAiModelVM {
  name: string;
  size: number;
}

export interface ModelRadioListProps {
  models: LocalAiModelVM[];
  activeName?: string;
  recommendedModelName?: string;
  onSelect: (name: string) => void;
}

export function ModelRadioList({
  models,
  activeName = "",
  recommendedModelName = RECOMMENDED_MODEL,
  onSelect,
}: ModelRadioListProps) {
  const groupId = useId();
  return (
    <RadioGroup
      value={activeName}
      onValueChange={onSelect}
      className="flex flex-col gap-2"
    >
      {models.map((m) => {
        const recommended =
          recommendedModelName &&
          (m.name === recommendedModelName ||
            m.name.startsWith(`${recommendedModelName}:`));
        return (
          <label
            key={m.name}
            htmlFor={`${groupId}-${m.name}`}
            className={cn(
              surfaceCardClass,
              "flex cursor-pointer items-center gap-2.5 p-3 transition-colors hover:border-primary/30 has-data-checked:border-primary/50 has-data-checked:bg-primary/5",
            )}
          >
            <RadioGroupItem id={`${groupId}-${m.name}`} value={m.name} />
            <span className="text-sm">{m.name}</span>
            {recommended && <Pill>Recommended</Pill>}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {formatModelSize(m.size)}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
