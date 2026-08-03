import type { Story } from "@ladle/react";
import { AccountCard } from "./account-card";

export default { title: "Settings / AccountCard" };

export const Default: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <AccountCard
        name="Louis Tenant"
        email="louis@kalaido.io"
        onSignOut={() => alert("Sign out clicked!")}
      />
    </div>
  );
};

export const EmailOnly: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <AccountCard
        name=""
        email="no-name@kalaido.io"
        onSignOut={() => alert("Sign out clicked!")}
      />
    </div>
  );
};
