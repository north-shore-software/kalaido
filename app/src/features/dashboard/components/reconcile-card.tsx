import { ArrowRightIcon } from "lucide-react";
import { Label, type StatusKind, StatusPill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { joinNames, type ReconcileSummary } from "../reconcile-summary";

export interface ReconcileCardProps {
  summary: ReconcileSummary;
  /** A wave is generating right now. */
  running?: boolean;
  /** What ended the last wave, when it did not run clean. */
  lastError?: string;
  /** Start was pressed and the first stop is being prepared. */
  starting?: boolean;
  onStart: () => void;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The dashboard's one hero card: what needs reconciling, whether the wave is
 * working on it, and the single way in. Three states — work waiting (with
 * Start), only reflections waiting (Start too: they publish without review,
 * but by default nothing generates until Start), and caught up, which is also
 * where the ritual ends. The wave is a button unless KALAIDO_AUTO_WAVE is set,
 * so the card only says "Preparing" while one is actually running; Start is
 * never greyed out while there is work.
 */
export function ReconcileCard({
  summary,
  running = false,
  lastError,
  starting,
  onStart,
}: ReconcileCardProps) {
  const { projections, ready, reflections, newFragments, names } = summary;

  let pill: { kind: StatusKind; text: string };
  let headline: string;
  const meta: string[] = [];
  let showStart = false;

  if (projections > 0) {
    pill = running
      ? { kind: "cyan", text: "Preparing" }
      : { kind: "drifting", text: `${projections} to review` };
    headline = `${count(projections, "projection", "projections")} ${
      projections === 1 ? "needs" : "need"
    } your review`;
    if (newFragments > 0)
      meta.push(count(newFragments, "new fragment", "new fragments"));
    if (names.length > 0) meta.push(joinNames(names));
    if (running || ready > 0) meta.push(`${ready} of ${projections} ready`);
    if (reflections > 0)
      meta.push(
        `${count(reflections, "reflection", "reflections")} ${
          running ? "updating" : "to update"
        }`,
      );
    showStart = true;
  } else if (reflections > 0) {
    pill = running
      ? { kind: "cyan", text: "Updating" }
      : { kind: "drifting", text: `${reflections} to update` };
    headline = running
      ? "Reflections are catching up"
      : "Reflections need updating";
    meta.push(
      `${count(reflections, "reflection", "reflections")} ${
        running ? "updating" : "to update"
      }`,
    );
    if (newFragments > 0)
      meta.push(count(newFragments, "new fragment", "new fragments"));
    showStart = true;
  } else {
    pill = { kind: "stable", text: "Up to date" };
    headline = "You’re all caught up";
    meta.push("Every projection reflects the latest fragments.");
  }
  if (lastError && !running) meta.push(`Last run failed: ${lastError}`);

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
