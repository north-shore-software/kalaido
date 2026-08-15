import type { Story } from "@ladle/react";
import { OAuthButtons } from "./oauth-buttons";

export default { title: "Settings / OAuthButtons" };

// Only one state to show: social sign-in is not wired up yet, so the buttons
// are inert by construction rather than by prop.
export const ComingSoon: Story = () => (
  <div className="max-w-sm p-4 bg-background border border-line">
    <OAuthButtons />
  </div>
);
