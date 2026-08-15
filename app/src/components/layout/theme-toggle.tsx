import { useId } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/css-utils";

interface ThemeToggleProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

const OPTIONS: readonly {
  value: Theme;
  label: string;
  Icon: typeof SunIcon;
}[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "Match system", Icon: MonitorIcon },
];

/**
 * Segmented appearance control. Lives in Settings rather than the app chrome:
 * the utility bar reports status and holds no controls.
 *
 * Built on real radio inputs — visually hidden, with the segment styled from
 * the checked state — so arrow-key navigation and screen reader semantics come
 * from the platform rather than being reimplemented.
 */
export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  const groupName = useId();

  return (
    <fieldset className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
      <legend className="sr-only">Appearance</legend>
      {OPTIONS.map(({ value, label, Icon }) => (
        <label
          key={value}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30",
            theme === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name={groupName}
            value={value}
            checked={theme === value}
            onChange={() => onChange(value)}
            className="sr-only"
          />
          <Icon className="size-3.5" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
