import { ArchiveIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { ColourSwatch, Mono } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface StreamColourOption {
  id: string;
  name: string;
  swatch: number;
}

const ALL = "all";

export interface StreamToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  colours: StreamColourOption[];
  colourId: string | null;
  onColourChange: (colourId: string | null) => void;
  shown: number;
  total: number;
  selecting: boolean;
  onSelectingChange: (selecting: boolean) => void;
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onArchive: () => void;
  archiving: boolean;
}

export function StreamToolbar({
  query,
  onQueryChange,
  colours,
  colourId,
  onColourChange,
  shown,
  total,
  selecting,
  onSelectingChange,
  selectedCount,
  onSelectAll,
  onClearSelection,
  onArchive,
  archiving,
}: StreamToolbarProps) {
  const items = [
    { value: ALL, label: "All colours" },
    ...colours.map((c) => ({
      value: c.id,
      label: (
        <span className="flex items-center gap-1.5">
          <ColourSwatch c={c.swatch} />
          {c.name || "Untitled colour"}
        </span>
      ),
    })),
  ];
  const filtered = shown !== total;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-fg-4" />
          <Input
            aria-label="Filter fragments"
            placeholder="Filter by text"
            className="pl-5"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                onQueryChange("");
              }
            }}
          />
        </div>
        <Select
          items={items}
          value={colourId ?? ALL}
          onValueChange={(next) =>
            onColourChange(!next || next === ALL ? null : next)
          }
        >
          <SelectTrigger className="w-44" aria-label="Filter by colour">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={selecting ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={selecting}
          onClick={() => onSelectingChange(!selecting)}
        >
          {selecting ? "Done" : "Select"}
        </Button>
      </div>
      {(filtered || selecting) && (
        <div className="flex min-h-[25px] items-center gap-3 text-meta text-fg-3">
          <Mono>{filtered ? `${shown} of ${total}` : `${total}`}</Mono>
          {selecting && (
            <>
              <span className="text-fg-4">·</span>
              <Mono>{selectedCount} selected</Mono>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                disabled={shown === 0 || selectedCount === shown}
                onClick={onSelectAll}
              >
                Select all {shown}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={selectedCount === 0}
                onClick={onClearSelection}
              >
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedCount === 0 || archiving}
                onClick={onArchive}
              >
                <ArchiveIcon />
                Archive {selectedCount}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
