import type { Story } from "@ladle/react";
import { useState } from "react";
import { CloudAuthPanel } from "./cloud-auth-panel";

export default { title: "Onboarding / CloudAuthPanel" };

/** Submitting talks to the auth server; in the workbench it fails inline. */
export const SignIn: Story = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="w-[540px] bg-background p-6">
      <CloudAuthPanel mode={mode} onModeChange={setMode} />
    </div>
  );
};

export const SignUp: Story = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  return (
    <div className="w-[540px] bg-background p-6">
      <CloudAuthPanel mode={mode} onModeChange={setMode} />
    </div>
  );
};
