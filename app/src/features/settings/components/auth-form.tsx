import { useId, useState } from "react";
import {
  RequiredPill,
  RevealToggle,
  requiredHighlightClass,
  useRequiredHighlights,
} from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/css-utils";

export interface AuthFormProps {
  mode: "signin" | "signup";
  error?: string | null;
  busy?: boolean;
  onSubmit: (input: { email: string; password: string }) => void;
}

/**
 * Email and password, and nothing else.
 *
 * Mode is chosen entirely by the caller's toggle — this form has no toggle of
 * its own. Two controls for one piece of state is how a user ends up watching
 * the tabs above say "Sign in" while the button below says "Create account".
 *
 * There is no name field: an account needs an email to be addressable and a
 * password to be secured, and nothing about a display name is load-bearing for
 * either. Where a name would have been shown, the email is.
 */
export function AuthForm({ mode, error, busy, onSubmit }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const emailFieldId = useId();
  const passwordFieldId = useId();
  const { highlighted: highlightedFields, trigger: triggerHighlights } =
    useRequiredHighlights({ email: emailFieldId, password: passwordFieldId });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const missing: ("email" | "password")[] = [];
    if (!email.trim()) missing.push("email");
    if (!password.trim()) missing.push("password");

    if (missing.length > 0) {
      triggerHighlights(missing);
      return;
    }

    onSubmit({ email, password });
  };

  const isFormIncomplete = !email.trim() || !password.trim();

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label
          htmlFor={emailFieldId}
          className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Email
        </label>
        <div className="relative flex items-center">
          <Input
            id={emailFieldId}
            type="email"
            placeholder="you@domain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className={cn(
              "h-12 w-full text-[18px] transition-all duration-150 placeholder:text-muted-foreground/80",
              highlightedFields.has("email") && [
                requiredHighlightClass,
                "pr-24",
              ],
            )}
          />
          {highlightedFields.has("email") && (
            <RequiredPill className="right-2" />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor={passwordFieldId}
          className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Password
        </label>
        <div className="relative flex items-center">
          <Input
            id={passwordFieldId}
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className={cn(
              "h-12 w-full pr-10 text-[18px] transition-all duration-150 placeholder:text-muted-foreground/80",
              highlightedFields.has("password") && [
                requiredHighlightClass,
                "pr-28",
              ],
            )}
          />
          {highlightedFields.has("password") && (
            <RequiredPill className="right-11" />
          )}
          {password && (
            <RevealToggle
              shown={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
              subject="password"
            />
          )}
        </div>
      </div>

      {error && <p className="text-meta text-critical-ink">{error}</p>}

      <div className="flex justify-center pt-2">
        <Button
          type="submit"
          variant="commit"
          size="default"
          disabled={busy}
          className={cn(
            "min-w-[180px] px-8",
            isFormIncomplete && "opacity-50 hover:opacity-50",
          )}
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
