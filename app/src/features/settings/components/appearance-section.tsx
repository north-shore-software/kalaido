import { SectionHeader } from "@/components/layout/section";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useTheme } from "@/providers/theme-provider";

/**
 * Theme's home. It used to live in the utility bar, which is now status-only —
 * this is the only place appearance can be changed.
 */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <SectionHeader
        title="Appearance"
        description="Choose how Kalaido looks. Match system follows your operating system's light and dark setting."
      />
      <ThemeToggle theme={theme} onChange={setTheme} />
    </div>
  );
}
