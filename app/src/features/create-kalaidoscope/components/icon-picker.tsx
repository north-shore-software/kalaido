import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideProps } from "lucide-react";
import * as Icons from "lucide-react";
import { SmileIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  className?: string;
}

export function IconPicker({ value, onChange, className }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeHighlight, setActiveHighlight] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const names = q
      ? ALL_ICON_NAMES.filter((n) => n.toLowerCase().includes(q))
      : ALL_ICON_NAMES;
    return names.slice(0, 200);
  }, [search]);

  const SelectedIcon = value ? getIcon(value) : null;

  useEffect(() => {
    if (!activeHighlight || open) return;
    function handlePointerDown(e: PointerEvent) {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setActiveHighlight(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [activeHighlight, open]);

  function pick(name: string) {
    if (value === name) {
      onChange("");
    } else {
      onChange(name);
    }
  }

  function handleRemove() {
    onChange("");
    setActiveHighlight(false);
    setOpen(false);
    setSearch("");
  }

  function handleDone() {
    if (value) {
      setActiveHighlight(true);
    }
    setOpen(false);
    setSearch("");
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        onFocus={() => {
          if (value) setActiveHighlight(true);
        }}
        onBlur={() => setActiveHighlight(false)}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-lg border transition-all duration-150 outline-none",
          activeHighlight
            ? "border-cyan-edge bg-cyan-wash text-white shadow-[0_0_10px_rgba(34,211,238,0.25)]"
            : "border-line bg-muted/30 text-fg-1 hover:border-foreground/30 hover:bg-muted",
          className,
        )}
        aria-label="Pick icon"
      >
        {SelectedIcon ? (
          <SelectedIcon
            className={cn(
              "size-5 transition-colors",
              activeHighlight ? "text-white" : "text-foreground",
            )}
          />
        ) : (
          <SmileIcon className="size-5 text-muted-foreground" />
        )}
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && value) {
            setActiveHighlight(true);
          }
        }}
      >
        <DialogContent className="flex h-[520px] max-w-lg flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-line bg-muted/30 transition-all">
                {SelectedIcon ? (
                  <SelectedIcon className="size-6 text-white" />
                ) : (
                  <SmileIcon className="size-6 text-muted-foreground" />
                )}
              </div>
              <DialogTitle className="text-card-title font-semibold">
                Choose an icon
              </DialogTitle>
            </div>

            <Input
              autoFocus
              placeholder="Search icons…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-3 h-10 text-body font-normal placeholder:font-normal placeholder:text-muted-foreground/50"
            />
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-4">
            <div className="grid grid-cols-6 gap-2">
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
                      "flex aspect-square items-center justify-center rounded-md border border-transparent transition-all duration-150",
                      "text-muted-foreground hover:border-cyan-edge hover:bg-cyan-wash hover:text-white",
                      value === name &&
                        "border-cyan-edge bg-cyan-wash text-cyan",
                    )}
                  >
                    <Icon className="size-6" />
                  </button>
                );
              })}
            </div>
            {search && filtered.length === 0 && (
              <p className="py-12 text-center text-body-sm text-muted-foreground">
                No icons found for "{search}"
              </p>
            )}
            {!search && (
              <p className="pt-4 text-center text-meta text-muted-foreground">
                Showing first 200 — search to narrow down.
              </p>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between border-t px-6 py-4">
            <div className="flex flex-1 justify-start">
              {value && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRemove}
                  className="h-[25px] gap-1.5 font-mono text-btn-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-surface-2 hover:text-foreground"
                >
                  <Trash2Icon className="size-3.5" />
                  Remove icon
                </Button>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDone}
              className="h-[25px] font-mono text-btn-sm transition-colors hover:border-cyan-edge hover:bg-cyan-wash hover:text-cyan"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
