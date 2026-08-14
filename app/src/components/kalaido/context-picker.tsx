import { useEffect, useRef, useState } from "react";
import {
  FileTextIcon,
  GlobeIcon,
  SquareIcon,
  WavesIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/css-utils";
import { PaneHeader } from "@/components/layout/page-chrome";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useContextSources } from "@/hooks/use-context-sources";
import { resolveContextTokens } from "@/api/kalaidoscope/context";
import { itemsToSpec } from "@/api/kalaidoscope/chat";
import { ColourSwatch } from "./colour";
import { Label, Mono } from "./text";

import type { ContextItem, ContextKind } from "@/api/kalaidoscope/chat.ts";

export type { ContextItem, ContextKind };

const sameItem = (
  a: { kind: string; id: string },
  b: { kind: string; id: string },
): boolean => a.kind === b.kind && a.id === b.id;

function itemIcon(it: ContextItem) {
  switch (it.kind) {
    case "Colour":
      return <ColourSwatch value={it.value} size={12} />;
    case "Projection":
      return <FileTextIcon className="size-3.5 text-truth-ink" />;
    case "Reflection":
      return <WavesIcon className="size-3.5 text-fg-3" />;
    default:
      return <SquareIcon className="size-3.5 text-fg-3" />;
  }
}

export function ContextItems({
  items,
  onRemove,
  className,
}: {
  items: ContextItem[];
  onRemove: (it: ContextItem) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {items.map((it) => (
        <button
          type="button"
          key={`${it.kind}:${it.id}`}
          onClick={() => onRemove(it)}
          className="group flex items-center gap-2.5 rounded-md border border-line bg-card px-3 py-2.5 text-left"
        >
          {itemIcon(it)}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[12.5px] font-semibold">
              {it.label}
            </span>
            <Label className="text-[9.5px]">{it.kind}</Label>
          </div>
          <XIcon className="size-3.5 text-fg-4 group-hover:text-fg-2" />
        </button>
      ))}
    </div>
  );
}

/**
 * Shown when nothing is picked. An empty selection is a real, meaningful state —
 * no filters means the whole kalaidoscope is in scope — so we render it as a
 * deliberate default rather than leaving the pane blank.
 */
export function ContextEmptyState() {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-dashed border-line bg-surface-2/40 px-3 py-2.5">
      <GlobeIcon className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold">Everything</span>
        <span className="text-[10.5px] leading-snug text-fg-4">
          Searching your whole kalaidoscope, unfiltered
        </span>
      </div>
    </div>
  );
}

interface ContextPickerProps {
  /** Pre-selected items; the picker owns its selection state from here on. */
  initialValues?: ContextItem[];
  onChange?: (values: ContextItem[]) => void;
  /**
   * Render only the item list + add control, with no surrounding pane chrome —
   * for use inside a column that already provides its own "Context" heading.
   */
  bare?: boolean;
  className?: string;
}

export function ContextPicker({
  initialValues,
  onChange,
  bare,
  className,
}: ContextPickerProps) {
  const [selected, setSelected] = useState<ContextItem[]>(initialValues ?? []);
  const [open, setOpen] = useState(false);
  const sources = useContextSources();

  const tokenCache = useRef<Record<string, number>>({});
  const [resolvedTokens, setResolvedTokens] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    // Empty selection means "whole scope" (see itemsToSpec); ask the backend for
    // its total directly since there are no per-item entries to cache.
    if (selected.length === 0) {
      void (async () => {
        try {
          const res = await resolveContextTokens(itemsToSpec([]));
          if (active) setResolvedTokens(res.totalTokens);
        } catch (err) {
          console.error(err);
        }
      })();
      return () => {
        active = false;
      };
    }

    const sumFromCache = () =>
      selected.reduce(
        (sum, it) => sum + (tokenCache.current[`${it.kind}:${it.id}`] || 0),
        0,
      );

    const missingItems = selected.filter(
      (it) => tokenCache.current[`${it.kind}:${it.id}`] === undefined,
    );

    if (missingItems.length === 0) {
      setResolvedTokens(sumFromCache());
      return;
    }

    // Fetch only the items we haven't priced yet; the breakdown keys match
    // `${kind}:${id}`, so we merge them straight into the cache.
    void (async () => {
      try {
        const res = await resolveContextTokens(itemsToSpec(missingItems));
        if (!active) return;
        Object.assign(tokenCache.current, res.breakdown);
        setResolvedTokens(sumFromCache());
      } catch (err) {
        console.error(err);
      }
    })();

    return () => {
      active = false;
    };
  }, [selected]);

  const commit = (next: ContextItem[]) => {
    setSelected(next);
    onChange?.(next);
  };
  const remove = (it: ContextItem) =>
    commit(selected.filter((s) => !sameItem(s, it)));
  const toggle = (it: ContextItem) =>
    commit(
      selected.some((s) => sameItem(s, it))
        ? selected.filter((s) => !sameItem(s, it))
        : [...selected, it],
    );

  const groups: {
    kind: ContextKind;
    heading: string;
    options: ContextItem[];
  }[] = [
    {
      kind: "Colour",
      heading: "Colours",
      options: sources.colours.map((c) => ({
        kind: "Colour",
        id: c.id,
        label: c.name,
        value: c.value,
      })),
    },
    {
      kind: "Type",
      heading: "Types",
      options: sources.types.map((t) => ({
        kind: "Type",
        id: t.value,
        label: t.label,
      })),
    },
    {
      kind: "Projection",
      heading: "Projections",
      options: sources.projections.map((p) => ({
        kind: "Projection",
        id: p.id,
        label: p.name,
      })),
    },
    {
      kind: "Reflection",
      heading: "Reflections",
      options: sources.reflections.map((r) => ({
        kind: "Reflection",
        id: r.id,
        label: r.name,
      })),
    },
  ];

  const addControl = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="mt-2.5 w-full rounded-md border border-dashed border-border p-3 text-center text-[11.5px] text-fg-4 hover:border-fg-4 hover:text-fg-2">
        + Colour · Type · Projection · Reflection
      </PopoverTrigger>
      <PopoverContent align="start" className="overflow-hidden p-0">
        <Command>
          <CommandInput placeholder="Search context…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {groups.map(
              (g) =>
                g.options.length > 0 && (
                  <CommandGroup key={g.kind} heading={g.heading}>
                    {g.options.map((opt) => (
                      <CommandItem
                        key={`${opt.kind}:${opt.id}`}
                        value={`${opt.label} ${opt.id}`}
                        data-checked={
                          selected.some((s) => sameItem(s, opt))
                            ? "true"
                            : undefined
                        }
                        onSelect={() => toggle(opt)}
                      >
                        {itemIcon(opt)}
                        <span className="min-w-0 flex-1 truncate">
                          {opt.label}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  if (bare) {
    return (
      <div className={cn("flex flex-col", className)}>
        {selected.length === 0 ? (
          <ContextEmptyState />
        ) : (
          <ContextItems items={selected} onRemove={remove} />
        )}
        {addControl}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-[262px] shrink-0 flex-col border-r border-line",
        className,
      )}
    >
      <PaneHeader label="Context" />
      <div className="flex-1 overflow-y-auto p-4">
        <Mono className="mb-2.5 block text-[10.5px] text-fg-4">
          inputs feeding this context
        </Mono>
        {selected.length === 0 ? (
          <ContextEmptyState />
        ) : (
          <ContextItems items={selected} onRemove={remove} />
        )}
        {addControl}
        {resolvedTokens != null && (
          <div className="mt-3.5 rounded-md bg-surface-2 p-2.5">
            <div className="flex items-center gap-2">
              <WavesIcon className="size-3.5 text-fg-3" />
              <Mono className="text-[11px] text-fg-2">
                resolves to ~{resolvedTokens} tokens
              </Mono>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
