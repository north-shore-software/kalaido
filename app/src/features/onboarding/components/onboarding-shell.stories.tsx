import type { Story } from "@ladle/react";
import { OnboardingShell } from "./onboarding-shell";

export default { title: "Onboarding / OnboardingShell" };

const body = (
  <div className="border border-line bg-surface-1 p-6 text-body-sm text-fg-2">
    Page content goes here.
  </div>
);

export const Default: Story = () => (
  <OnboardingShell
    title="Welcome to Kalaido"
    description="Where would you like to start?"
  >
    {body}
  </OnboardingShell>
);

export const WithoutMark: Story = () => (
  <OnboardingShell title="Sign in" showMark={false}>
    {body}
  </OnboardingShell>
);
