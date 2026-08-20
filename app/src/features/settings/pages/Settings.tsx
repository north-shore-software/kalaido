import { ArrowLeftIcon } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { defineRoute } from "@/routes/route-kit";
import { RouteLink } from "@/routes/route-link";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { cn } from "../../../lib/css-utils";
import { AppearanceSection } from "../components/appearance-section";
import { CloudAccountSection } from "../components/cloud-account-section";
import { DangerZoneSection } from "../components/danger-zone-section";
import { KalaidoscopesSection } from "../components/kalaidoscopes-section";
import { LocalAISection } from "../components/local-ai-section";
import { MapSection } from "../components/map-section";
import { settingsTransitions } from "./Settings.transitions";

const sections = [
  { id: "kalaidoscopes", label: "Manage Kalaidoscopes" },
  { id: "cloud-account", label: "Cloud Account" },
  { id: "local-ai", label: "Local AI" },
  { id: "appearance", label: "Appearance" },
  { id: "map", label: "Map" },
  { id: "danger", label: "Danger Zone" },
];

export default function Settings() {
  const { go } = useAppNavigate();
  const { section = "kalaidoscopes" } = useParams<{ section: string }>();

  return (
    <div
      className="flex bg-background overflow-hidden"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <nav className="w-54 shrink-0 border-r border-line bg-surface-1 p-3 flex flex-col gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => go(settingsTransitions.close)}
          className="mb-2 justify-start gap-1.5 text-fg-4 hover:text-fg-1"
        >
          <ArrowLeftIcon />
          Back
        </Button>
        {sections.map((s) => (
          <RouteLink
            key={s.id}
            data-settings-section={s.id}
            transition={settingsTransitions.selectSection}
            params={{ section: s.id }}
            className={cn(
              "block border-l-2 border-l-transparent px-2.5 py-2 text-item transition-colors",
              s.id === "danger"
                ? section === s.id
                  ? "border-l-critical bg-critical-wash font-semibold text-critical-ink"
                  : "text-critical-ink/70 hover:bg-critical-wash hover:text-critical-ink"
                : section === s.id
                  ? "border-l-section bg-section-wash font-semibold text-section-ink"
                  : "text-fg-3 hover:bg-surface-2 hover:text-fg-1",
            )}
          >
            {s.label}
          </RouteLink>
        ))}
      </nav>
      <main className="flex-1 overflow-auto px-8 pt-8 pb-12">
        <div className="flex max-w-[1000px] flex-col gap-8">
          <h1 className="font-display text-display font-medium text-fg-1">
            Settings
          </h1>
          {section === "danger" ? (
            <DangerZoneSection />
          ) : section === "cloud-account" ? (
            <CloudAccountSection />
          ) : section === "local-ai" ? (
            <LocalAISection />
          ) : section === "appearance" ? (
            <AppearanceSection />
          ) : section === "map" ? (
            <MapSection />
          ) : (
            <KalaidoscopesSection />
          )}
        </div>
      </main>
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
