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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-label uppercase text-muted-foreground">
          Email
        </label>
        <Input
          type="email"
          placeholder="you@domain.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy}
          className="h-10 text-body-sm placeholder:text-muted-foreground/40"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-label uppercase text-muted-foreground">
          Password
        </label>
        <Input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={busy}
          className="h-10 text-body-sm placeholder:text-muted-foreground/40"
        />
      </div>

      {error && <p className="text-meta text-critical-ink">{error}</p>}

      <div className="flex justify-center pt-2">
        <Button
          type="submit"
          variant="commit"
          size="default"
          disabled={busy || !email.trim() || !password.trim()}
          className="min-w-[180px] px-8"
        >
          {busy ? (
            <Spinner />
          ) : mode === "signin" ? (
            "Sign in"
          ) : (
            "Create account"
          )}
        </Button>
      </div>
    </form>
  );
}
