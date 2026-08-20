import { useId, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Pill } from "@/components/kalaido";
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

export function AuthForm({ mode, error, busy, onSubmit }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const emailFieldId = useId();
  const passwordFieldId = useId();
  const [highlightedFields, setHighlightedFields] = useState<
    Set<"email" | "password">
  >(new Set());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerHighlights(fields: ("email" | "password")[]) {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedFields(new Set(fields));
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedFields(new Set());
      const firstMissing = fields[0];
      if (firstMissing === "email") {
        document.getElementById(emailFieldId)?.focus();
      } else if (firstMissing === "password") {
        document.getElementById(passwordFieldId)?.focus();
      }
    }, 500);
  }

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
              highlightedFields.has("email") &&
                "border-b-critical focus-visible:border-b-critical focus:border-b-critical bg-critical/10 pr-24 shadow-[0_0_12px_rgba(255,51,51,0.25)] ring-1 ring-critical/40",
            )}
          />
          {highlightedFields.has("email") && (
            <Pill className="pointer-events-none absolute right-2 border-critical/40 bg-critical/20 text-critical-ink animate-in fade-in duration-150">
              Required
            </Pill>
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
              highlightedFields.has("password") &&
                "border-b-critical focus-visible:border-b-critical focus:border-b-critical bg-critical/10 pr-28 shadow-[0_0_12px_rgba(255,51,51,0.25)] ring-1 ring-critical/40",
            )}
          />
          {highlightedFields.has("password") && (
            <Pill className="pointer-events-none absolute right-11 border-critical/40 bg-critical/20 text-critical-ink animate-in fade-in duration-150">
              Required
            </Pill>
          )}
          {password && (
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground outline-none"
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
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
