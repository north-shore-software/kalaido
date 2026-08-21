import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export interface ChoiceProps {
  icon: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

export function PrimaryChoice({
  icon,
  title,
  description,
  disabled,
  onClick,
}: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-[116px] items-center gap-4 rounded-lg border border-cyan-edge bg-cyan-veil p-5 text-left transition-[border-color,box-shadow] duration-150 hover:border-cyan hover:shadow-[0_0_16px_rgba(34,211,238,0.35)] disabled:opacity-60"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border transition-colors group-hover:border-cyan-edge group-hover:bg-cyan-wash group-hover:text-cyan">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-card-title font-bold">{title}</span>
        <span className="text-[15px] text-fg-3">{description}</span>
      </div>
      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-cyan" />
    </button>
  );
}

export function SecondaryChoice({
  icon,
  title,
  description,
  disabled,
  onClick,
}: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex h-full min-h-[116px] items-center gap-3.5 rounded-lg border border-dashed p-5 text-left transition-colors hover:border-foreground/30 hover:bg-surface-2 disabled:opacity-60"
    >
      <div className="shrink-0 text-muted-foreground">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-card-title font-semibold">{title}</span>
        <span className="text-[15px] text-fg-3">{description}</span>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-cyan" />
    </button>
  );
}
