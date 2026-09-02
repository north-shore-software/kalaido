import { useState } from "react";
import { toast } from "sonner";
import { backfillReflection } from "@/api/kalaidoscope/reflections";
import { Label } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * "Summarize further back": materialize the grid windows between a date and
 * the ones the schedule already covers, and generate them. Generation runs
 * server-side in the background; the summary log fills in live.
 */
export function BackfillCard({
  reflectionId,
  onStarted,
}: {
  reflectionId: string;
  onStarted?: () => void;
}) {
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!from || busy) return;
    setBusy(true);
    const res = await backfillReflection(
      reflectionId,
      new Date(`${from}T00:00:00`).toISOString(),
    );
    setBusy(false);
    if (res.isErr()) {
      toast.error("Backfill failed", { description: res.error.message });
      return;
    }
    const n = res.value.windows.length;
    toast.success(
      n === 0
        ? "Nothing to backfill for that date"
        : `Generating ${n} historical ${n === 1 ? "summary" : "summaries"}…`,
    );
    setFrom("");
    onStarted?.();
  }

  return (
    <div className="flex flex-col gap-2 rounded-none border border-line p-3.5">
      <Label>Backfill history</Label>
      <p className="text-body-sm leading-relaxed text-fg-2">
        Generate summaries for earlier windows, back to a date.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={from}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="Backfill from date"
          disabled={busy}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!from || busy}
          onClick={() => void run()}
        >
          {busy ? "Starting…" : "Backfill"}
        </Button>
      </div>
    </div>
  );
}
