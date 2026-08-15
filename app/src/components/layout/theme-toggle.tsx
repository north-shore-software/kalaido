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
 */
export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          onClick={() => onChange(value)}
          aria-checked={theme === value}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            theme === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
