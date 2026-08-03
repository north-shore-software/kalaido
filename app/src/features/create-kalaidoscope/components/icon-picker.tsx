import { useMemo, useState } from "react";
import type { LucideProps } from "lucide-react";
import * as Icons from "lucide-react";
import { SmileIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/css-utils";

type IconComponent = React.ComponentType<LucideProps>;

const ALL_ICON_NAMES: string[] = Object.keys(Icons).filter(
  (k) => /^[A-Z]/.test(k) && !k.endsWith("Icon") && k !== "LucideProvider",
);

function getIcon(name: string): IconComponent | null {
  const ic = (Icons as Record<string, unknown>)[name];
  return ic != null ? (ic as IconComponent) : null;
}

export interface IconPickerProps {
  value?: string;
  onChange: (name: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const names = q
      ? ALL_ICON_NAMES.filter((n) => n.toLowerCase().includes(q))
      : ALL_ICON_NAMES;
    return names.slice(0, 200);
  }, [search]);

  const SelectedIcon = value ? getIcon(value) : null;

  function pick(name: string) {
    onChange(name);
    setOpen(false);
    setSearch("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Pick icon"
      >
        {SelectedIcon ? (
          <SelectedIcon className="size-4" />
        ) : (
          <SmileIcon className="size-4" />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex flex-col gap-0 p-0 max-w-md h-[480px]">
          <DialogHeader className="px-4 pt-4 pb-3 shrink-0">
            <DialogTitle className="text-sm">Choose an icon</DialogTitle>
            <Input
              autoFocus
              placeholder="Search icons…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-2"
            />
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="grid grid-cols-8 gap-1">
              {filtered.map((name) => {
                const Icon = getIcon(name);
                if (!Icon) return null;
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => pick(name)}
                    className={cn(
                      "flex aspect-square items-center justify-center transition-colors",
                      "hover:bg-muted text-muted-foreground hover:text-foreground",
                      value === name && "bg-primary/10 text-primary",
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
            {search && filtered.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No icons found for "{search}"
              </p>
            )}
            {!search && (
              <p className="pt-3 text-center text-xs text-muted-foreground">
                Showing first 200 — search to narrow down.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
