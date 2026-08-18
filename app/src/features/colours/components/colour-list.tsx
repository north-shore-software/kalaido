import { ColourSwatch, EmptyState, ListRow } from "@/components/kalaido";
import { swatchIndex } from "@/lib/colors";
import type { ColourResponse } from "@/api/kalaidoscope/types";

export function ColourList({
  colours,
  isLoading,
  countByColour,
  selectedId,
  onSelect,
}: {
  colours: ColourResponse[];
  isLoading: boolean;
  countByColour: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex w-[280px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-3">
      {colours.length === 0 ? (
        <EmptyState className="px-2 py-3">
          {isLoading
            ? "Loading colours…"
            : "No colours yet. Create one to start tagging fragments."}
        </EmptyState>
      ) : (
        colours.map((c) => (
          <ListRow
            key={c.id}
            selected={c.id === selectedId}
            onClick={() => onSelect(c.id)}
            leading={
              <ColourSwatch
                c={swatchIndex(c.id)}
                value={c.colour_value || undefined}
                size={16}
                className="rounded-none"
              />
            }
            title={c.name || "Untitled colour"}
            subtitle={`${countByColour.get(c.id) ?? 0} fragments`}
          />
        ))
      )}
    </div>
  );
}
