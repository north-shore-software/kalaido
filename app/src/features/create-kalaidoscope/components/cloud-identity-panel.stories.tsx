import type { Story } from "@ladle/react";
import { CloudIdentityPanel, CloudSignInNotice } from "./cloud-identity-panel";

export default { title: "Create Kalaidoscope / CloudIdentityPanel" };

export const SignedIn: Story = () => (
  <div className="w-[540px] bg-background p-4">
    <CloudIdentityPanel
      name="Louis Collard"
      email="louis@example.com"
      onSignOut={() => {}}
    />
  </div>
);

/** No display name on the account: the email stands in for it. */
export const SignedInNoName: Story = () => (
  <div className="w-[540px] bg-background p-4">
    <CloudIdentityPanel email="louis@example.com" onSignOut={() => {}} />
  </div>
);

export const SignInNotice: Story = () => (
  <div className="w-[540px] bg-background p-4">
    <CloudSignInNotice onSignIn={() => {}} />
  </div>
);
