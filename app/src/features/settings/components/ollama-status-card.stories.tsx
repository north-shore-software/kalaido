import type { Story } from "@ladle/react";
import { OllamaStatusCard } from "./ollama-status-card";

export default { title: "Settings / OllamaStatusCard" };

export const Reachable: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <OllamaStatusCard
        reachable={true}
        modelCount={3}
        onRefresh={() => alert("Refreshed!")}
      />
    </div>
  );
};

export const Unreachable: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <OllamaStatusCard
        reachable={false}
        modelCount={0}
        onRefresh={() => alert("Refreshed!")}
      />
    </div>
  );
};
