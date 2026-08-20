import { Eye, EyeOff } from "lucide-react";

export interface RevealToggleProps {
  shown: boolean;
  onToggle: () => void;
  /** What the eye reveals — "password", "API key" — for the aria-label. */
  subject: string;
}

/**
 * The eye that flips a secret field between masked and plain text. Sits at the
 * right edge of the field's relative wrapper, outside the tab order.
 */
export function RevealToggle({ shown, onToggle, subject }: RevealToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      tabIndex={-1}
      aria-label={`${shown ? "Hide" : "Show"} ${subject}`}
      className="absolute right-2 flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground outline-none"
    >
      {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}
