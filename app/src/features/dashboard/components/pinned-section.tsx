import { EmptyState, Label } from "@/components/kalaido";
import type { PinItem } from "../types";
import { PinCard } from "./pin-card";

export interface PinnedSectionProps {
  items: PinItem[];
  onOpen: (item: PinItem) => void;
  onUnpin: (item: PinItem) => void;
}

export function PinnedSection({ items, onOpen, onUnpin }: PinnedSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Label>Pinned projections &amp; reflections</Label>
        <div className="flex-1" />
      </div>
      {items.length === 0 ? (
        <EmptyState>
          Pin projections or reflections to see them here.
        </EmptyState>
      ) : (
        <div className="flex flex-wrap gap-3.5">
          {items.map((it) => (
            <PinCard
              key={`${it.kind}:${it.id}`}
              item={it}
              onOpen={onOpen}
              onUnpin={onUnpin}
            />
          ))}
        </div>
      )}
    </section>
  );
}
