import type { Story } from "@ladle/react";
import { useState } from "react";
import { AuthForm } from "./auth-form";
import { action } from "@/lib/story-utils.ts";

export default { title: "Settings / AuthForm" };

export const SignIn: Story = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="max-w-sm p-4 bg-background border border-line">
      <AuthForm
        mode={mode}
        onSubmit={(input) =>
          alert(`Submitted email: ${input.email}, password: ${input.password}`)
        }
        onToggleMode={() => setMode(mode === "signin" ? "signup" : "signin")}
      />
    </div>
  );
};

export const SignUp: Story = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  return (
    <div className="max-w-sm p-4 bg-background border border-line">
      <AuthForm
        mode={mode}
        onSubmit={(input) =>
          alert(`Submitted email: ${input.email}, name: ${input.name}`)
        }
        onToggleMode={() => setMode(mode === "signin" ? "signup" : "signin")}
      />
    </div>
  );
};

export const ErrorState: Story = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="max-w-sm p-4 bg-background border border-line">
      <AuthForm
        mode={mode}
        error="Invalid password or user does not exist"
        onSubmit={action("onSubmit")}
        onToggleMode={() => setMode(mode === "signin" ? "signup" : "signin")}
      />
    </div>
  );
};

export const BusyState: Story = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="max-w-sm p-4 bg-background border border-line">
      <AuthForm
        mode={mode}
        busy={true}
        onSubmit={action("onSubmit")}
        onToggleMode={() => setMode(mode === "signin" ? "signup" : "signin")}
      />
    </div>
  );
};
