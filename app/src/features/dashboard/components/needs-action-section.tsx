import { Label, StatusPill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import type { NeedItem } from "../types";
import { NeedsRow } from "./needs-row";

export interface NeedsActionSectionProps {
  items: NeedItem[];
  onAction: (item: NeedItem) => void;
  /** Id of the row currently generating a candidate, if any. */
  busyId?: string | null;
  /**
   * Start a background generation wave over everything listed here. Omit when
   * every row already has its candidate — there is nothing left to generate.
   */
  onGenerateAll?: () => void;
  /** The background wave is working; the action is shown but not pressable. */
  generating?: boolean;
}

export function NeedsActionSection({
  items,
  onAction,
  busyId,
  onGenerateAll,
  generating,
}: NeedsActionSectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Label>Needs action</Label>
        <StatusPill kind="drifting">{items.length}</StatusPill>
        {onGenerateAll && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={generating}
            onClick={onGenerateAll}
          >
            {generating ? "Generating…" : "Generate all"}
          </Button>
        )}
      </div>
      {items.map((item) => (
        <NeedsRow
          key={item.id}
          item={item}
          onAction={onAction}
          busy={busyId === item.id}
          disabled={!!busyId && busyId !== item.id}
        />
      ))}
    </section>
  );
}
