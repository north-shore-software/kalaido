import { useState } from "react";
import { cn } from "@/lib/css-utils";
import { Metric } from "../metric";

/**
 * The context window the synthesis will be generated against.
 *
 * TODO: this is a property of the *generating model*, not a constant. Until the
 * backend reports the model bound to an entity, one number stands in for all of
 * them — which is why it lives here alone rather than being spread through the
 * readout's arithmetic.
 */
export const CONTEXT_WINDOW_TOKENS = 1_000_000;

/** Past this share of the window a spec is warned about but not blocked. */
const NEAR_LIMIT = 0.8;

export interface Contributor {
  /** Display name, already resolved from the `Kind:id` breakdown key. */
  name: string;
  tokens: number;
}

interface ResolutionReadoutProps {
  totalTokens: number | null;
  contributors: Contributor[];
  /** Null while unknown — rendered as absent rather than as zero. */
  fragmentCount: number | null;
  sourceCount: number;
  onAutoSegment?: () => void;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

const fmtCount = (n: number) => n.toLocaleString("en-US");

/**
 * The foot of the funnel: what everything above it actually costs, always
 * present rather than appearing only on failure.
 *
 * Attribution is the point. A single total cannot answer the only question a
 * blocked user has — *what is making this big* — so the breakdown the token
 * endpoint already returns is rendered per contributor instead of being summed
 * and discarded.
 */
export function ResolutionReadout({
  totalTokens,
  contributors,
  fragmentCount,
  sourceCount,
  onAutoSegment,
}: ResolutionReadoutProps) {
  const [open, setOpen] = useState(false);

  const total = totalTokens ?? 0;
  const share = total / CONTEXT_WINDOW_TOKENS;
  const over = share > 1;
  const near = !over && share >= NEAR_LIMIT;

  const accent = over
    ? "text-critical-ink"
    : near
      ? "text-drifting-ink"
      : "text-section-ink";
  const accentBg = over ? "bg-critical" : near ? "bg-drifting" : "bg-section";
  const edge = over
    ? "border-critical/50"
    : near
      ? "border-drifting/45"
      : "border-line";

  const volume = [
    fragmentCount == null
      ? null
      : `${fmtCount(fragmentCount)} fragment${fragmentCount === 1 ? "" : "s"}`,
    sourceCount > 0
      ? `${sourceCount} source snapshot${sourceCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The ratio is carried by the metric and its bar, so this says what the ratio
  // *means*. No growth rate is measured anywhere yet, so the warning states the
  // trajectory in words rather than inventing a number for it.
  const trajectory = over
    ? "Over — hard stop"
    : near
      ? "Near the limit — grows on its own"
      : "Fits";

  const ranked = [...contributors].sort((a, b) => b.tokens - a.tokens);
  const lead = ranked[0];
  const leadShare =
    lead && total > 0 ? `${Math.round((lead.tokens / total) * 100)}%` : null;

  return (
    <div
      className={cn(
        "flex max-h-[50%] shrink-0 flex-col border-t bg-surface-1",
        edge,
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">
        {/* A labelled big number over a progress bar is exactly what `Metric`
            is for, so the readout borrows it rather than restating it. */}
        <Metric
          label="Resolves to"
          value={totalTokens == null ? "—" : `${fmtTokens(total)} tokens`}
          sub={`of ${fmtTokens(CONTEXT_WINDOW_TOKENS)}`}
          valueClassName={accent}
          bar={`${Math.min(share * 100, 100)}%`}
          barClassName={accentBg}
          className="mb-2"
        />

        <div className="mb-3 flex items-baseline gap-3 font-mono text-mono-sm">
          <span className="min-w-0 truncate text-fg-4">
            {volume || "Nothing resolved"}
          </span>
          <span
            className={cn(
              "ml-auto shrink-0",
              over || near ? accent : "text-fg-5",
            )}
          >
            {trajectory}
          </span>
        </div>

        {ranked.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="flex w-full items-baseline gap-2 border-0 bg-transparent pb-2.5 text-left text-label font-semibold uppercase text-fg-4 hover:text-fg-2"
            >
              <span
                className={cn(
                  "text-[9px] text-fg-5 transition-transform",
                  !open && "-rotate-90",
                )}
              >
                ▾
              </span>
              <span>Breakdown</span>
              {!open && lead && (
                <span className="ml-auto truncate font-mono text-mono-sm font-normal tracking-normal normal-case text-fg-5">
                  {lead.name}
                  {leadShare ? ` · ${leadShare}` : ""}
                </span>
              )}
            </button>

            {open && (
              <div className="flex flex-col gap-[7px]">
                {ranked.map((c) => {
                  const pct =
                    total > 0 ? Math.round((c.tokens / total) * 100) : 0;
                  return (
                    <div key={c.name}>
                      <div className="mb-1 flex items-baseline gap-2 font-mono text-mono-sm">
                        <span className="min-w-0 truncate text-fg-2">
                          {c.name}
                        </span>
                        <span className="ml-auto shrink-0 text-fg-4">
                          {fmtTokens(c.tokens)}
                        </span>
                        <span className="w-9 shrink-0 text-right text-fg-5">
                          {pct}%
                        </span>
                      </div>
                      <div className="h-[3px] bg-surface-2">
                        <div
                          className={cn(
                            "h-[3px]",
                            pct > 50 ? accentBg : "bg-fg-5",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {over && (
        <div className="shrink-0 border-t border-line px-5 pb-4 pt-3">
          <p className="mb-2.5 text-meta text-fg-4 text-pretty">
            No colours to filter on? Auto-segment reads the whole kalaidoscope
            and proposes colours that carve it up. They become permanent
            workspace vocabulary.
          </p>
          <button
            type="button"
            onClick={onAutoSegment}
            className="clip-chamfer w-full border border-section bg-section px-3.5 py-2.5 text-btn font-bold uppercase text-section-foreground shadow-section hover:opacity-85"
          >
            Auto-segment my scope
          </button>
        </div>
      )}
    </div>
  );
}
