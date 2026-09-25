import type { ReactNode } from "react";
import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/css-utils";

export interface DecisionOption {
  id: string;
  label: ReactNode;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  disabled?: boolean;
  onSelect: () => void;
}

export interface DecisionCardProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Rendered in order; the first option is the one the page recommends. */
  options: DecisionOption[];
  /** An answer is being carried out: every option is disabled. */
  busy?: boolean;
  className?: string;
}

/**
 * A question the page asks in the chat column, answered from a fixed set of
 * options rather than typed. It renders like a turn in the stream — the same
 * box the regenerate and context confirmations use — but it is the page's,
 * not the model's: nothing is sent, and the owner decides what each answer
 * does. Pages use it as a gate: while one is up, the rest of the page is
 * disabled until it is answered or set aside.
 */
export function DecisionCard({
  icon,
  title,
  description,
  options,
  busy = false,
  className,
}: DecisionCardProps) {
  return (
    <div className={cn("flex justify-start", className)}>
      <div className="max-w-[85%] space-y-2.5 rounded-none border border-line bg-surface-2 p-3 text-body-sm">
        <div className="flex items-center gap-2 font-medium text-fg-1">
          {icon}
          <span>{title}</span>
        </div>
        {description && (
          <div className="text-meta text-fg-3">{description}</div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {options.map((opt) => (
            <Button
              key={opt.id}
              size="xs"
              variant={opt.variant ?? "outline"}
              onClick={opt.onSelect}
              disabled={busy || opt.disabled}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
