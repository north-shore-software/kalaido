import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { SectionHeader } from "@/components/layout/section";
import { cn } from "@/lib/css-utils";
import type { Theme } from "@/lib/theme";
import { useTheme } from "@/providers/theme-provider";

const THEME_OPTIONS: readonly {
  value: Theme;
  label: string;
  Icon: typeof SunIcon;
}[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "Match system", Icon: MonitorIcon },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="Appearance"
        description="Choose how Kalaido looks. Match system follows your operating system's light and dark setting."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {THEME_OPTIONS.map(({ value, label, Icon }) => {
          const isSelected = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                "group flex flex-col justify-between gap-6 rounded-none border p-5 text-left transition-all duration-150",
                isSelected
                  ? "border-cyan-edge bg-cyan-veil shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                  : "border-dashed border-line-strong hover:border-cyan-edge hover:bg-cyan-wash dark:hover:border-foreground/30 dark:hover:bg-surface-2",
              )}
            >
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-none border transition-colors",
                  isSelected
                    ? "border-cyan-edge bg-surface-1 text-cyan"
                    : "border-line bg-surface-1 text-fg-3 group-hover:border-cyan-edge group-hover:text-cyan dark:group-hover:border-foreground/30 dark:group-hover:text-fg-1",
                )}
              >
                <Icon className="size-5" />
              </div>
              <span
                className={cn(
                  "text-card-title font-bold transition-colors",
                  isSelected ? "text-fg-1" : "text-fg-3 group-hover:text-fg-1",
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
