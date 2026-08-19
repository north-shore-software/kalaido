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
  return (
    <div
      role="radiogroup"
      aria-labelledby={ariaLabelledBy}
      className="grid grid-cols-2 gap-3"
    >
      {storageOptions.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-[96px] cursor-pointer flex-col justify-center gap-1 rounded-lg border p-4 text-left transition-all duration-150",
              isSelected
                ? "border-cyan-edge bg-cyan-veil shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                : "border-dashed hover:border-foreground/30 hover:bg-surface-2",
            )}
          >
            <span
              className={cn(
                "text-item font-semibold",
                isSelected ? "text-cyan" : "text-foreground",
              )}
            >
              {option.label}
            </span>
            <p className="text-body-sm leading-relaxed text-fg-3">
              {option.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
