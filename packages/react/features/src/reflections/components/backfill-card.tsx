import { backfillReflection } from "@kalaido/client/kalaidoscope/reflections";
import { kalaidoscopeEndpointTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { Label } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Input } from "@kalaido/primitives/shadcn/input";
import { useExternalWrite } from "@kalaido/state/live";
import { useState } from "react";
import { toast } from "sonner";
import { REFLECTION_WINDOWS_ENDPOINT } from "../hooks/use-reflection-windows";

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
  const client = useKalaidoscopeClient();
  const [from, setFrom] = useState("");

  const backfillWrite = useExternalWrite<
    string,
    { readonly ids: readonly string[] }
  >({
    execute: async (fromIso) =>
      (await backfillReflection(reflectionId, fromIso)).map((r) => ({
        ids: r.windows.map((w) => `${w.start}_${w.end}`),
      })),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeEndpointTag(client.baseURL, REFLECTION_WINDOWS_ENDPOINT),
    ],
  });

  async function run() {
    if (!from) return;
    const outcome = await backfillWrite.run(
      new Date(`${from}T00:00:00`).toISOString(),
    );
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Backfill failed", { description: outcome.error.message });
      return;
    }
    const n = outcome.ids.length;
    toast.success(
      n === 0
        ? "Nothing to backfill for that date"
        : `Generating ${n} historical ${n === 1 ? "summary" : "summaries"}…`,
    );
    setFrom("");
    onStarted?.();
  }

  const busy = backfillWrite.isPending;

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
          onValueChange={setFrom}
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
