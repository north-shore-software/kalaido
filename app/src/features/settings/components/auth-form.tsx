import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export interface AuthFormProps {
  mode: "signin" | "signup";
  error?: string | null;
  busy?: boolean;
  onSubmit: (input: { email: string; password: string; name?: string }) => void;
  onToggleMode: () => void;
}

export function AuthForm({
  mode,
  error,
  busy,
  onSubmit,
  onToggleMode,
}: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ email, password, name: mode === "signup" ? name : undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      {mode === "signup" && (
        <Input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={busy}
        />
      )}
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
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground text-center"
        onClick={onToggleMode}
        disabled={busy}
      >
        {mode === "signin"
          ? "Don't have an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
