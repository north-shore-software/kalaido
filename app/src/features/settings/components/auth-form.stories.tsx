import type { Story } from "@ladle/react";
import { AuthForm } from "./auth-form";
import { action } from "@/lib/story-utils.ts";

export default { title: "Settings / AuthForm" };

// `mode` is the caller's to own — the form has no toggle — so each story pins
// it rather than wiring up local state that no real caller has.
export const SignIn: Story = () => (
  <div className="max-w-sm p-4 bg-background border border-line">
    <AuthForm mode="signin" onSubmit={action("onSubmit")} />
  </div>
);

export const SignUp: Story = () => (
  <div className="max-w-sm p-4 bg-background border border-line">
    <AuthForm mode="signup" onSubmit={action("onSubmit")} />
  </div>
);

export const ErrorState: Story = () => (
  <div className="max-w-sm p-4 bg-background border border-line">
    <AuthForm
      mode="signin"
      error="Invalid password or user does not exist"
      onSubmit={action("onSubmit")}
    />
  </div>
);

export const BusyState: Story = () => (
  <div className="max-w-sm p-4 bg-background border border-line">
    <AuthForm mode="signin" busy onSubmit={action("onSubmit")} />
  </div>
);
