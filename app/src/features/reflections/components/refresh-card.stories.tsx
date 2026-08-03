import type { Story } from "@ladle/react";
import { useState } from "react";
import { RefreshCard } from "./refresh-card";
import { action } from "@/lib/story-utils.ts";

export default { title: "Reflections / RefreshCard" };

export const Idle: Story = () => {
  return (
    <div className="w-[240px] p-4 bg-background">
      <RefreshCard regenerating={false} onRefresh={() => alert("Refreshed!")} />
    </div>
  );
};

export const Regenerating: Story = () => {
  return (
    <div className="w-[240px] p-4 bg-background">
      <RefreshCard regenerating={true} onRefresh={action("onRefresh")} />
    </div>
  );
};

export const Interactive: Story = () => {
  const [regenerating, setRegenerating] = useState(false);
  const handleRefresh = () => {
    setRegenerating(true);
    setTimeout(() => {
      setRegenerating(false);
    }, 2000);
  };
  return (
    <div className="w-[240px] p-4 bg-background">
      <RefreshCard regenerating={regenerating} onRefresh={handleRefresh} />
    </div>
  );
};
