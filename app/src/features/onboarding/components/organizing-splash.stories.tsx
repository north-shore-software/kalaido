import type { Story } from "@ladle/react";
import { useState } from "react";
import { action } from "@/lib/story-utils.ts";
import { OrganizingSplash } from "./organizing-splash";

export default { title: "Onboarding / OrganizingSplash" };

export const Running: Story = () => (
  <OrganizingSplash onSkip={action("skip")} />
);

export const WithProgress: Story = () => (
  <OrganizingSplash progress={0.42} onSkip={action("skip")} />
);

export const Ending: Story = () => {
  const [ending, setEnding] = useState(false);
  return (
    <>
      <OrganizingSplash
        progress={ending ? 1 : 0.94}
        ending={ending}
        onSnapshotReady={action("snapshot ready")}
        onEnded={action("ended")}
      />
      <button
        type="button"
        onClick={() => setEnding(true)}
        className="fixed right-4 bottom-3.5 z-50 rounded border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-fg-4 opacity-40 transition-opacity hover:opacity-100"
      >
        play ending
      </button>
    </>
  );
};
