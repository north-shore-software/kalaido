import type { Story } from "@ladle/react";
import { SurfaceCard } from "./surface-card.tsx";

export default { title: "Kalaido / SurfaceCard" };

export const Default: Story = () => (
  <div className="max-w-md p-4">
    <SurfaceCard>
      <h3 className="text-sm font-semibold mb-1">API Integration Settings</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Configure your local pocketbase sync and background sidecar endpoints.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="px-3 py-1.5 bg-foreground text-background text-xs font-semibold rounded-md"
        >
          Save Settings
        </button>
        <button
          type="button"
          className="px-3 py-1.5 border hover:bg-surface-2 text-xs font-semibold rounded-md"
        >
          Reset to Default
        </button>
      </div>
    </SurfaceCard>
  </div>
);
