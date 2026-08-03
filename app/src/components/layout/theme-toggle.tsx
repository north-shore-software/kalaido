import { MoonIcon, SunIcon } from "lucide-react";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/css-utils";

interface ThemeToggleProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div className="flex items-center rounded-full border border-border bg-muted p-0.5">
      {(
        [
          { value: "light", label: "Light mode", Icon: SunIcon },
          { value: "dark", label: "Dark mode", Icon: MoonIcon },
        ] as const
      ).map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-label={label}
          aria-pressed={theme === value}
          tabIndex={-1}
          className={cn(
            "flex size-5 items-center justify-center rounded-full transition-colors",
            theme === value
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3" />
        </button>
      ))}
    </div>
  );
}
