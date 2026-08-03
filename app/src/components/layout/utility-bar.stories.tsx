import type { Story } from "@ladle/react";
import { useState } from "react";
import { SidecarStatusDot } from "./sidecar-status-dot";
import { ThemeToggle } from "./theme-toggle";
import { LocationLabel } from "./location-label";
import type { SidecarPhase } from "@/api/app/local-scopes";
import type { Theme } from "@/lib/theme";

export default { title: "Layout / Utility Bar Components" };

export const SidecarStatusDotStory: Story = () => {
  const phases: SidecarPhase[] = [
    "running",
    "spawning",
    "starting",
    "stopping",
    "failed",
    "stopped",
    "idle",
  ];

  return (
    <div className="p-4 bg-background border border-line rounded-lg flex flex-col gap-4">
      <h3 className="text-sm font-semibold mb-2">Sidecar Status Dot Phases</h3>
      <div className="grid grid-cols-2 gap-2 max-w-xs">
        {phases.map((phase) => (
          <div key={phase} className="flex items-center gap-2">
            <SidecarStatusDot phase={phase} />
            <span className="text-xs font-mono">{phase}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

SidecarStatusDotStory.storyName = "SidecarStatusDot";

export const ThemeToggleStory: Story = () => {
  const [theme, setTheme] = useState<Theme>("light");
  return (
    <div className="p-4 bg-background border border-line rounded-lg flex flex-col gap-4">
      <h3 className="text-sm font-semibold mb-2">Controlled Theme Toggle</h3>
      <div className="flex items-center gap-4">
        <ThemeToggle theme={theme} onChange={setTheme} />
        <span className="text-xs text-muted-foreground">
          Current state: {theme}
        </span>
      </div>
    </div>
  );
};

ThemeToggleStory.storyName = "ThemeToggle";

export const LocationLabelStory: Story = () => {
  return (
    <div className="p-4 bg-background border border-line rounded-lg flex flex-col gap-4 max-w-md">
      <h3 className="text-sm font-semibold mb-2">Location Label Truncation</h3>
      <div className="flex flex-col gap-3">
        <div>
          <span className="text-xs text-muted-foreground block mb-1">
            Short Path (no truncation):
          </span>
          <LocationLabel location="/Users/louis/project" />
        </div>
        <div>
          <span className="text-xs text-muted-foreground block mb-1">
            Long Path (truncation active):
          </span>
          <LocationLabel location="/Users/louis/Code/kalaido/open/app/src/components/layout/utility-bar.tsx" />
        </div>
        <div>
          <span className="text-xs text-muted-foreground block mb-1">
            Cloud URL (no truncation):
          </span>
          <LocationLabel
            location="https://api.kalaido.cloud/v1/workspaces/proj_12345"
            truncate={false}
          />
        </div>
      </div>
    </div>
  );
};

LocationLabelStory.storyName = "LocationLabel";
