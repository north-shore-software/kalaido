import { Label, Timeline, type TimelineItem } from "@/components/kalaido";

export interface SummaryLogProps {
  items: TimelineItem[];
}

export function SummaryLog({ items }: SummaryLogProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <Label>Summary log</Label>
      {items.length > 0 ? (
        <Timeline items={items} tone="section" />
      ) : (
        <p className="text-meta text-fg-4">No snapshots yet.</p>
      )}
    </div>
  );
}
