import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/css-utils";

export type StorageType = "local_file" | "cloud";

interface StorageOption {
  value: StorageType;
  label: string;
  description: string;
}

const storageOptions: StorageOption[] = [
  {
    value: "local_file",
    label: "Local",
    description: "Stored on this device only",
  },
  {
    value: "cloud",
    label: "Cloud",
    description: "Synced across your devices",
  },
];

export interface StorageOptionCardsProps {
  value: StorageType;
  onChange: (v: StorageType) => void;
  "aria-labelledby"?: string;
}

export function StorageOptionCards({
  value,
  onChange,
  "aria-labelledby": ariaLabelledBy,
}: StorageOptionCardsProps) {
  const groupId = useId();
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as StorageType)}
      aria-labelledby={ariaLabelledBy}
      className="grid grid-cols-2 gap-3"
    >
      {storageOptions.map((option) => (
        <label
          key={option.value}
          htmlFor={`${groupId}-${option.value}`}
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors",
            "hover:bg-muted/30 hover:border-primary/30",
            "has-data-checked:border-primary/50 has-data-checked:bg-primary/5",
          )}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem
              id={`${groupId}-${option.value}`}
              value={option.value}
            />
            <span className="text-sm font-medium">{option.label}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pl-[1.625rem]">
            {option.description}
          </p>
        </label>
      ))}
    </RadioGroup>
  );
}
