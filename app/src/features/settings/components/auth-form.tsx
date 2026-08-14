import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export interface AuthFormProps {
  mode: "signin" | "signup";
  error?: string | null;
  busy?: boolean;
  onSubmit: (input: { email: string; password: string }) => void;
}

/**
 * Email and password, and nothing else.
 *
 * Mode is chosen entirely by the caller's `<Segmented>` control — this form has
 * no toggle of its own. Two controls for one piece of state is how a user ends
 * up watching the top switch say "Sign in" while the button below says "Create
 * account".
 *
 * There is no name field: an account needs an email to be addressable and a
 * password to be secured, and nothing about a display name is load-bearing for
 * either. Where a name would have been shown, the email is.
 */
export function AuthForm({ mode, error, busy, onSubmit }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      <Input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={busy}
      />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        disabled={busy}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? <Spinner /> : mode === "signin" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
