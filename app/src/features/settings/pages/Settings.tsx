import { ArrowLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";
import { defineRoute } from "@/routes/route-kit";
import { RouteLink } from "@/routes/route-link";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { AppearanceSection } from "../components/appearance-section";
import { CloudAccountSection } from "../components/cloud-account-section";
import { DangerZoneSection } from "../components/danger-zone-section";
import { KalaidoscopesSection } from "../components/kalaidoscopes-section";
import { LocalAISection } from "../components/local-ai-section";
import { settingsTransitions } from "./Settings.transitions";

const sections = [
  { id: "kalaidoscopes", label: "Manage Kalaidoscopes" },
  { id: "cloud-account", label: "Cloud Account" },
  { id: "local-ai", label: "Local AI" },
  { id: "appearance", label: "Appearance" },
  { id: "danger", label: "Danger Zone" },
] as const;

export default function Settings() {
  const { go } = useAppNavigate();
  const { section = "kalaidoscopes" } = useAppParams<"settings">();
  const currentSection = sections.find((s) => s.id === section) ?? sections[0];

  return (
    <div className="flex -mt-[var(--titlebar-height)] h-svh overflow-hidden bg-background">
      <nav className="w-54 shrink-0 border-r border-line bg-surface-1 p-3 pt-[calc(var(--titlebar-height)+0.75rem)] flex flex-col">
        <div className="mb-2 pb-2 border-b border-line">
          <Button
            variant="ghost"
            onClick={() => go(settingsTransitions.close)}
            className="w-full justify-start gap-2.5 text-fg-3 hover:text-fg-1"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          {sections.map((s) => {
            const active = section === s.id;
            const isDanger = s.id === "danger";
            return (
              <RouteLink
                key={s.id}
                data-settings-section={s.id}
                transition={settingsTransitions.selectSection}
                params={{ section: s.id }}
                className={cn(
                  "flex h-[60px] items-center border-l-2 px-3.5 text-item transition-colors",
                  isDanger
                    ? active
                      ? "border-l-critical bg-critical-wash font-semibold text-critical-ink"
                      : "border-l-transparent text-critical-ink/70 hover:bg-critical-wash/60 hover:text-critical-ink"
                    : active
                      ? "border-l-fg-1 bg-surface-2 font-semibold text-fg-1"
                      : "border-l-transparent text-fg-3 hover:bg-surface-2/60 hover:text-fg-1",
                )}
              >
                {s.label}
              </RouteLink>
            );
          })}
        </div>
      </nav>
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden pt-[var(--titlebar-height)]">
        <header className="shrink-0 border-b border-line bg-background px-8 py-4">
          <div className="flex items-center gap-1.5 font-mono text-crumb uppercase text-fg-4">
            <span>Settings</span>
            <CaretRightIcon className="size-2.5 text-fg-5" />
            <span className="text-fg-2">{currentSection.label}</span>
          </div>
          <h1 className="mt-1 font-display text-display text-fg-1">Settings</h1>
        </header>
        <main className="flex-1 overflow-y-auto px-8 pt-8 pb-12">
          <div className="flex max-w-2xl flex-col gap-8">
            {section === "danger" ? (
              <DangerZoneSection />
            ) : section === "cloud-account" ? (
              <CloudAccountSection />
            ) : section === "local-ai" ? (
              <LocalAISection />
            ) : section === "appearance" ? (
              <AppearanceSection />
            ) : (
              <KalaidoscopesSection />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export const settingsRoute = defineRoute({
  id: "settings",
  path: "/settings/:section?",
  feature: "Settings",
  requiredScope: [],
  transitions: settingsTransitions,
  Component: Settings,
});
