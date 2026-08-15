import { useParams } from "react-router-dom";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "../../../lib/css-utils";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/layout/section";
import { KalaidoscopesSection } from "../components/kalaidoscopes-section";
import { DangerZoneSection } from "../components/danger-zone-section";
import { CloudAccountSection } from "../components/cloud-account-section";
import { LocalAISection } from "../components/local-ai-section";
import { AppearanceSection } from "../components/appearance-section";
import { defineRoute } from "@/routes/route-kit";
import { settingsTransitions } from "./Settings.transitions";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { RouteLink } from "@/routes/route-link";

const sections = [
  { id: "cloud-account", label: "Cloud Account" },
  { id: "local-ai", label: "Local AI" },
  { id: "kalaidoscopes", label: "Manage Kalaidoscopes" },
  { id: "appearance", label: "Appearance" },
  { id: "danger", label: "Danger Zone" },
];

const placeholderContent: Record<
  string,
  { title: string; description: string }
> = {
  general: {
    title: "General",
    description: "Manage your general preferences and application settings.",
  },
  account: {
    title: "Account",
    description: "Update your account details and personal information.",
  },
  billing: {
    title: "Billing",
    description: "View your subscription, usage, and payment information.",
  },
};

export default function Settings() {
  const { go } = useAppNavigate();
  const { section = "general" } = useParams<{ section: string }>();

  return (
    <div
      className="flex bg-background overflow-hidden"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <nav className="w-48 shrink-0 border-r p-3 flex flex-col gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => go(settingsTransitions.close)}
          className="justify-start gap-1.5 text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeftIcon />
          Back
        </Button>
        {sections.map((s) => (
          <RouteLink
            key={s.id}
            transition={settingsTransitions.selectSection}
            params={{ section: s.id }}
            className={cn(
              "block px-3 py-2 text-sm transition-colors",
              s.id === "danger"
                ? section === s.id
                  ? "bg-destructive/10 text-destructive font-medium"
                  : "text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                : section === s.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s.label}
          </RouteLink>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-8">
        {section === "kalaidoscopes" ? (
          <KalaidoscopesSection />
        ) : section === "danger" ? (
          <DangerZoneSection />
        ) : section === "cloud-account" ? (
          <CloudAccountSection />
        ) : section === "local-ai" ? (
          <LocalAISection />
        ) : section === "appearance" ? (
          <AppearanceSection />
        ) : (
          (() => {
            const content =
              placeholderContent[section] ?? placeholderContent.general;
            return (
              <SectionHeader
                title={content.title}
                description={content.description}
              />
            );
          })()
        )}
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
