import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useContextSources } from "@/hooks/use-context-sources";
import { useFragmentLabels } from "@/hooks/use-fragment-labels";
import { cn } from "@/lib/css-utils";
import { ContextPicker } from "./context-picker";
import { itemsToSelection } from "./selection";
import type { ContextItem, EntityKind } from "./types";

const MODE_SUMMARY = {
  except: "Everything, except…",
  only: "Only…",
  none: "No fragments — syntheses only",
} as const;

const KIND_ABBREV: Record<string, string> = {
  Colour: "Colour",
  Type: "Type",
  Fragment: "Frag",
  Projection: "Proj",
  Reflection: "Refl",
};

export interface ContextSummaryProps {
  value?: ContextItem[];
  onChange?: (values: ContextItem[]) => void;
  entity?: EntityKind;
  className?: string;
}

/**
 * The funnel does not fit a 300px rail, so the rails get a read-only summary of
 * what is currently declared and open the funnel in a dialog to change it.
 *
 * Read-only is the point: a squeezed funnel would still be a funnel, but the
 * stages would stop reading as stages, and the mode control — the one part that
 * makes the union semantics legible — is the first thing to break.
 */
export function ContextSummary({
  value,
  onChange,
  entity = "projection",
  className,
}: ContextSummaryProps) {
  const [open, setOpen] = useState(false);
  const sources = useContextSources();
  const items = useMemo(() => value ?? [], [value]);
  const selection = useMemo(() => itemsToSelection(items), [items]);

  const fragmentIds = useMemo(
    () => items.filter((it) => it.kind === "Fragment").map((it) => it.id),
    [items],
  );
  const fragmentLabels = useFragmentLabels(fragmentIds);

  const label = (kind: string, id: string, fallback: string) => {
    if (kind === "Fragment") return fragmentLabels.get(id) ?? fallback;
    if (kind === "Colour")
      return sources.colours.find((c) => c.id === id)?.name ?? fallback;
    if (kind === "Type")
      return sources.types.find((t) => t.value === id)?.label ?? fallback;
    if (kind === "Projection")
      return sources.projections.find((p) => p.id === id)?.name ?? fallback;
    if (kind === "Reflection")
      return sources.reflections.find((r) => r.id === id)?.name ?? fallback;
    return fallback;
  };

  const rows = [
    ...selection.criteria.map((c) => ({ ...c, tone: "criteria" as const })),
    ...selection.sources.map((s) => ({ ...s, tone: "source" as const })),
    ...selection.focus.map((f) => ({ ...f, tone: "focus" as const })),
  ];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="font-mono text-crumb font-semibold uppercase text-fg-4">
        {MODE_SUMMARY[selection.mode]}
      </span>

      {rows.length === 0 ? (
        <p className="text-meta text-fg-5 text-pretty">
          Searching your whole kalaidoscope, unfiltered.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <div
              key={`${r.tone}:${r.kind}:${r.id}`}
              className={cn(
                "flex items-center gap-2 border border-line-strong bg-surface-1 px-2 py-1.5",
                r.tone === "source" &&
                  "shadow-[inset_3px_0_0_var(--yellow-base)]",
                r.tone === "focus" &&
                  "shadow-[inset_3px_0_0_var(--magenta-base)]",
              )}
            >
              <span
                className={cn(
                  "shrink-0 border px-1 py-px font-mono text-pill font-bold uppercase",
                  r.tone === "source"
                    ? "border-yellow-line text-yellow-ink"
                    : r.tone === "focus"
                      ? "border-magenta-edge text-magenta-ink"
                      : "border-line-strong text-fg-3",
                )}
              >
                {KIND_ABBREV[r.kind] ?? r.kind}
              </span>
              <span className="min-w-0 truncate text-meta font-semibold text-fg-2">
                {label(r.kind, r.id, r.label)}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 w-full border border-dashed border-line-strong px-3 py-2 text-btn-sm font-semibold uppercase text-fg-3 hover:border-cyan hover:text-cyan-ink"
      >
        Edit context
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(860px,90vh)] max-w-[480px] flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b border-line px-5 pt-5 pb-4">
            <DialogTitle className="text-card-title font-bold">
              Context
            </DialogTitle>
            <DialogDescription className="text-body-sm text-fg-3 text-pretty">
              A standing rule for which of your material counts. It re-resolves
              as new material arrives.
            </DialogDescription>
          </DialogHeader>
          <ContextPicker
            flush
            entity={entity}
            value={value}
            onChange={onChange}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
