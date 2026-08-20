import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/css-utils";

export interface OptionCard<T extends string> {
  value: T;
  label: string;
  /** One line renders as a paragraph; two render as a stacked pair. */
  lines: string[];
}

export interface OptionCardsProps<T extends string> {
  options: readonly OptionCard<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-labelledby"?: string;
}

/**
 * The DESIGN.md "Option selection cards" recipe: a two-column radio grid where
 * the selected card wears the cyan edge, veil, and halo, and unselected cards
 * sit behind a dashed border. Built on the base-ui radio primitives so the
 * group carries real radio semantics (roving tabindex, arrow-key movement)
 * instead of a row of buttons wearing `role="radio"`.
 */
export function OptionCards<T extends string>({
  options,
  value,
  onChange,
  disabled,
  "aria-labelledby": ariaLabelledBy,
}: OptionCardsProps<T>) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as T)}
      disabled={disabled}
      aria-labelledby={ariaLabelledBy}
      className="grid-cols-2"
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <RadioPrimitive.Root
            key={option.value}
            value={option.value}
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
            {option.lines.length === 1 ? (
              <p className="text-body-sm leading-relaxed text-fg-3">
                {option.lines[0]}
              </p>
            ) : (
              <div className="flex flex-col text-body-sm leading-snug text-fg-3">
                {option.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            )}
          </RadioPrimitive.Root>
        );
      })}
    </RadioGroup>
  );
}
