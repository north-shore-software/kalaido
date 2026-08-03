import type { Story } from "@ladle/react";
import { OAuthButtons } from "./oauth-buttons";
import { action } from "@/lib/story-utils.ts";

export default { title: "Settings / OAuthButtons" };

export const Default: Story = () => {
  return (
    <div className="max-w-sm p-4 bg-background border border-line">
      <OAuthButtons
        onProvider={(provider) => alert(`Continue with ${provider}`)}
      />
    </div>
  );
};

export const Disabled: Story = () => {
  return (
    <div className="max-w-sm p-4 bg-background border border-line">
      <OAuthButtons onProvider={action("onProvider")} disabled={true} />
    </div>
  );
};
