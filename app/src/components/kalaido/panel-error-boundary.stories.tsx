import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PanelErrorBoundary, PanelErrorFallback } from "./panel-error-boundary";

export default { title: "Kalaido / PanelErrorBoundary" };

function Bomb({ armed }: { armed: boolean }) {
  if (armed) throw new Error("Markdown block 3 has no closing fence");
  return (
    <p className="text-body-sm text-fg-1" data-testid="panel-content">
      The panel is drawing normally.
    </p>
  );
}

/** A live boundary: arm the bomb to see the fallback, then recover. */
export const Default: Story = () => {
  const [armed, setArmed] = useState(false);
  return (
    <div className="flex w-[480px] flex-col gap-4 bg-background p-4">
      <Button size="sm" variant="outline" onClick={() => setArmed(true)}>
        Break the panel
      </Button>
      <div className="flex min-h-[160px] border border-line bg-surface-1">
        <PanelErrorBoundary label="this panel" onReset={() => setArmed(false)}>
          <Bomb armed={armed} />
        </PanelErrorBoundary>
      </div>
    </div>
  );
};

/** The fallback card on its own. */
export const Fallback: Story = () => (
  <div className="flex min-h-[160px] w-[480px] border border-line bg-surface-1">
    <PanelErrorFallback
      label="the chat"
      message="Cannot read properties of undefined (reading 'parts')"
      onRetry={() => {}}
    />
  </div>
);
