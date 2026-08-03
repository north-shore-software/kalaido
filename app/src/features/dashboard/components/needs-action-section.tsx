import { Label, StatusPill } from "@/components/kalaido";
import { NeedsRow } from "./needs-row";
import type { NeedItem } from "../types";

export interface NeedsActionSectionProps {
  items: NeedItem[];
  onAction: (item: NeedItem) => void;
}

export function NeedsActionSection({
  items,
  onAction,
}: NeedsActionSectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Label>Needs action</Label>
        <StatusPill kind="drifting">{items.length}</StatusPill>
      </div>
      {items.map((item) => (
        <NeedsRow key={item.id} item={item} onAction={onAction} />
      ))}
    </section>
  );
}
