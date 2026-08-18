import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { useContextSources } from "@/hooks/use-context-sources";
import { useFragmentLabels } from "@/hooks/use-fragment-labels";
import { cn } from "@/lib/css-utils";
import { withContextItem } from "@/lib/mentions";
import { useFragmentSearch } from "../context-picker/data";
import {
  ItemPicker,
  type PickerOption,
} from "../context-picker/item-picker";
import { allowsSources, type EntityKind } from "../context-picker/types";
import {
  type BarSources,
  deriveBarState,
  isChecked,
  KIND_ABBREV,
  removePin,
  summarizeChecked,
  toggleColour,
  toggleType,
} from "./state";

/** Keeps browsable kinds from crowding the pin search (mention-menu rule). */
const MAX_PER_KIND = 5;

type PanelSlot = "colours" | "types" | "pins";

export interface ContextBarProps {
  items: ContextItem[];
  onChange: (items: ContextItem[]) => void;
  /** Restricts the pin search (a reflection can only pin fragments). */
  entity?: EntityKind;
  className?: string;
}

/**
 * The context selector: a slim row above the composer with colour and type
 * checkbox lists (default all checked) and pinned specific items, together
 * resolving to the union the next turn will read. Selection logic lives in
 * `state.ts`; this component is stateless with respect to the selection — it
 * derives everything from `items` and emits via `onChange`.
 */
export function ContextBar({
  items,
  onChange,
  entity = "chat",
  className,
}: ContextBarProps) {
  const sources = useContextSources();
  const [open, setOpen] = useState<PanelSlot | null>(null);
  const [pinQuery, setPinQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const state = deriveBarState(items);

  const barSources = useMemo<BarSources>(
    () => ({
      types: sources.types.map((t) => ({ id: t.value, label: t.label })),
      colours: sources.colours.map((c) => ({
        id: c.id,
        label: c.name,
        value: c.value,
      })),
    }),
    [sources.types, sources.colours],
  );

  // Toggling while the sources are loading would enumerate an incomplete
  // universe and silently drop everything not yet fetched — hold until ready.
  const canToggle = !sources.loading;

  const fragmentSearch = useFragmentSearch(open === "pins" ? pinQuery : "");
  const fragmentLabels = useFragmentLabels(
    state.pins.filter((p) => p.kind === "Fragment").map((p) => p.id),
  );

  // The pin picker mixes kinds, and PickerOption has no kind field — options
  // carry a composite id and this map resolves a pick back to its item.
  const pinChoices = useMemo(() => {
    const options: PickerOption[] = [];
    const itemByKey = new Map<string, ContextItem>();
    const pinned = new Set(state.pins.map((p) => `${p.kind}:${p.id}`));
    const q = pinQuery.trim().toLowerCase();

    const offer = (item: ContextItem, meta: string) => {
      const key = `${item.kind}:${item.id}`;
      if (pinned.has(key)) return;
      itemByKey.set(key, item);
      options.push({ id: key, label: item.label, meta });
    };

    if (allowsSources(entity)) {
      for (const p of sources.projections
        .filter((o) => !q || o.name.toLowerCase().includes(q))
        .slice(0, MAX_PER_KIND)) {
        offer(
          { kind: "Projection", id: p.id, label: p.name },
          "projection",
        );
      }
      for (const r of sources.reflections
        .filter((o) => !q || o.name.toLowerCase().includes(q))
        .slice(0, MAX_PER_KIND)) {
        offer(
          { kind: "Reflection", id: r.id, label: r.name },
          "reflection",
        );
      }
    }
    for (const f of fragmentSearch.options) {
      offer({ kind: "Fragment", id: f.id, label: f.label }, f.meta ?? "");
    }
    return { options, itemByKey };
  }, [entity, sources, fragmentSearch.options, state.pins, pinQuery]);

  // Pins can arrive as bare ids (a stored spec holds nothing else) — resolve
  // display labels against the loaded catalogues, falling back to the label
  // the item was created with.
  function pinLabel(pin: ContextItem): string {
    if (pin.kind === "Fragment") {
      return fragmentLabels.get(pin.id) ?? pin.label;
    }
    const list =
      pin.kind === "Projection" ? sources.projections : sources.reflections;
    return list.find((o) => o.id === pin.id)?.name ?? pin.label;
  }

  function closePanel() {
    setOpen(null);
    setPinQuery("");
  }

  useEffect(() => {
    if (open == null) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(null);
        setPinQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedIds = (kind: "Type" | "Colour", opts: BarSources["types"]) =>
    new Set(opts.filter((o) => isChecked(state, kind, o.id)).map((o) => o.id));

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative shrink-0 border-t border-line px-4 py-2",
        className,
      )}
    >
      {open != null && (
        <div className="absolute inset-x-2 bottom-full z-10 mb-1">
          {open === "colours" && (
            <ItemPicker
              kindLabel="Colour"
              tint="cyan"
              options={barSources.colours}
              selectedIds={selectedIds("Colour", barSources.colours)}
              onPick={(o) => {
                if (canToggle) onChange(toggleColour(items, o.id, barSources));
              }}
              onClose={closePanel}
              emptyCopy="No colours yet — tag fragments with colours to filter by them."
            />
          )}
          {open === "types" && (
            <ItemPicker
              kindLabel="Type"
              tint="cyan"
              options={barSources.types}
              selectedIds={selectedIds("Type", barSources.types)}
              onPick={(o) => {
                if (canToggle) onChange(toggleType(items, o.id, barSources));
              }}
              onClose={closePanel}
              emptyCopy="No fragments yet, so there are no types to filter by."
            />
          )}
          {open === "pins" && (
            <ItemPicker
              kindLabel="Item"
              tint="yellow"
              options={pinChoices.options}
              remoteFiltered
              loading={fragmentSearch.loading}
              onQueryChange={setPinQuery}
              onPick={(o) => {
                const item = pinChoices.itemByKey.get(o.id);
                if (item) onChange(withContextItem(items, item));
                closePanel();
              }}
              onClose={closePanel}
              emptyCopy={
                allowsSources(entity)
                  ? "Search fragments by content, or projections and reflections by name."
                  : "Search fragments by content (a reflection reads fragments only)."
              }
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <BarTrigger
          label={`Colours · ${sources.loading ? "…" : summarizeChecked(state, "Colour", barSources.colours)}`}
          expanded={open === "colours"}
          onClick={() => setOpen(open === "colours" ? null : "colours")}
        />
        <BarTrigger
          label={`Types · ${sources.loading ? "…" : summarizeChecked(state, "Type", barSources.types)}`}
          expanded={open === "types"}
          onClick={() => setOpen(open === "types" ? null : "types")}
        />
        <BarTrigger
          label="+ Pin"
          expanded={open === "pins"}
          onClick={() => {
            setPinQuery("");
            setOpen(open === "pins" ? null : "pins");
          }}
        />
        {state.pins.map((pin) => (
          <button
            key={`${pin.kind}:${pin.id}`}
            type="button"
            title="Remove from context"
            onClick={() => onChange(removePin(items, pin))}
            className="flex min-w-0 items-center gap-1 rounded-none border border-yellow-line px-1.5 py-0.5 font-mono text-pill font-semibold text-yellow-ink hover:opacity-80"
          >
            <span className="shrink-0 uppercase">{KIND_ABBREV[pin.kind]}</span>
            <span className="min-w-0 truncate normal-case font-sans text-meta text-fg-1">
              {pinLabel(pin)}
            </span>
            <span className="shrink-0 text-fg-4">×</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BarTrigger({
  label,
  expanded,
  onClick,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-pill font-bold uppercase",
        expanded
          ? "border-cyan-edge bg-cyan-wash text-cyan-ink"
          : "border-line-strong text-fg-4 hover:text-fg-2",
      )}
    >
      {label}
    </button>
  );
}
