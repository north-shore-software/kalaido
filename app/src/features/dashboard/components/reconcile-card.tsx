import { ArrowRightIcon } from "lucide-react";
import { Label, type StatusKind, StatusPill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { joinNames, type ReconcileSummary } from "../reconcile-summary";

export interface ReconcileCardProps {
  summary: ReconcileSummary;
  /** Start was clicked and the first candidate is being located. */
  starting?: boolean;
  onStart: () => void;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The dashboard's one hero card: what needs reconciling, how ready it is, and
 * the single way in. Three states — work waiting (with Start), reflections
 * catching up on their own, and caught up, which is also where the ritual
 * ends. The wave prepares candidates in the background, so Start is never
 * greyed out while there is work: an unprepared first stop is joined
 * server-side rather than refused.
 */
export function ReconcileCard({
  summary,
  starting,
  onStart,
}: ReconcileCardProps) {
  const { projections, ready, reflections, newFragments, names } = summary;
  const preparing = projections > 0 && ready < projections;

  let pill: { kind: StatusKind; text: string };
  let headline: string;
  const meta: string[] = [];
  let showStart = false;

  if (projections > 0) {
    pill = preparing
      ? { kind: "cyan", text: "Preparing" }
      : { kind: "drifting", text: `${projections} to review` };
    headline = `${count(projections, "projection", "projections")} ${
      projections === 1 ? "needs" : "need"
    } your review`;
    if (newFragments > 0)
      meta.push(count(newFragments, "new fragment", "new fragments"));
    if (names.length > 0) meta.push(joinNames(names));
    if (preparing) meta.push(`${ready} of ${projections} ready`);
    if (reflections > 0)
      meta.push(`${count(reflections, "reflection", "reflections")} updating`);
    showStart = true;
  } else if (reflections > 0) {
    pill = { kind: "cyan", text: "Updating" };
    headline = "Reflections are catching up";
    meta.push(`${count(reflections, "reflection", "reflections")} updating`);
    if (newFragments > 0)
      meta.push(count(newFragments, "new fragment", "new fragments"));
  } else {
    pill = { kind: "stable", text: "Up to date" };
    headline = "You’re all caught up";
    meta.push("Every projection reflects the latest fragments.");
  }

  return (
    <section className="flex flex-col gap-3 rounded-none border border-cyan-edge bg-cyan-veil p-4">
      <div className="flex items-center gap-2.5">
        <Label>Reconcile</Label>
        <StatusPill kind={pill.kind}>{pill.text}</StatusPill>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-card-title font-bold text-fg-1">
            {headline}
          </span>
          <span className="text-meta text-fg-3">{meta.join(" · ")}</span>
        </div>
        {showStart && (
          <Button variant="commit" onClick={onStart} disabled={starting}>
            {starting ? "Starting…" : "Start"}
            <ArrowRightIcon />
          </Button>
        )}
      </div>
    </section>
  );
}
