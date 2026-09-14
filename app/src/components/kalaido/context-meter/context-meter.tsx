import { cn } from "@/lib/css-utils";
import { humanTokens } from "../context-bar/use-whole-scope-fits";

export interface ContextMeterProps {
  /** Tokens the next turn would send. Nothing renders until known. */
  total?: number;
  /** The model's prompt budget; unknown or 0 renders the count alone. */
  limit?: number;
  model?: string;
  className?: string;
}

/** Past this share of the budget the session is running out, not merely full. */
const NEAR = 0.8;

/**
 * How much of the context window the conversation has used: a thin track
 * that fills as the session grows, with the count beside it. Under budget it
 * wears the section accent — the state is fine; approaching it turns
 * `drifting`, past it `critical`, the same way every screen warns. The
 * chat's own guard still refuses an oversized turn; this only shows it coming.
 */
export function ContextMeter({
  total,
  limit,
  model,
  className,
}: ContextMeterProps) {
  if (total === undefined) return null;
  const hasLimit = !!limit && limit > 0;
  const ratio = hasLimit ? total / limit : 0;
  const tone = ratio > 1 ? "critical" : ratio >= NEAR ? "drifting" : "section";

  const fill = {
    section: "bg-section",
    drifting: "bg-drifting",
    critical: "bg-critical",
  }[tone];
  const ink = {
    section: "text-fg-4",
    drifting: "text-drifting-ink",
    critical: "text-critical-ink",
  }[tone];

  const caption = hasLimit
    ? `~${humanTokens(total)} / ${humanTokens(limit)}`
    : `~${humanTokens(total)}`;
  const title = hasLimit
    ? `About ${humanTokens(total)} tokens of the ~${humanTokens(limit)} ${model ?? "the model"} accepts`
    : `About ${humanTokens(total)} tokens`;

  return (
    <div className={cn("flex items-center gap-2", className)} title={title}>
      <div className="h-0.5 flex-1 rounded-none bg-line">
        <div
          className={cn("h-full rounded-none", fill)}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
      <span
        className={cn(
          "shrink-0 font-mono text-mono-sm tabular-nums whitespace-nowrap",
          ink,
        )}
      >
        {caption}
      </span>
    </div>
  );
}
