import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextItem, TimeWindow } from "@/api/kalaidoscope/chat";
import { type ScopeMode, setScopeMode } from "@/api/kalaidoscope/context-items";
import { useContextSources } from "@/hooks/use-context-sources";
import { useFragmentLabels } from "@/hooks/use-fragment-labels";
import { cn } from "@/lib/css-utils";
import { ColourSwatch } from "../colour";
import { useFragmentSearch } from "../context-picker/data";
import { ItemPicker, type PickerOption } from "../context-picker/item-picker";
import { allowsSources, type EntityKind } from "../context-picker/types";
import {
  addPin,
  deriveBarState,
  fullBlockedBy,
  KIND_ABBREV,
  removePin,
} from "./state";
import { humanTokens, useWholeScopeFits } from "./use-whole-scope-fits";

/** Keeps browsable kinds from crowding the pin search (mention-menu rule). */
const MAX_PER_KIND = 5;

export interface ContextBarProps {
  items: ContextItem[];
  onChange: (items: ContextItem[]) => void;
  /** Restricts the pin search (a reflection can only pin fragments). */
  entity?: EntityKind;
  /** A reflection's target window — the whole-scope estimate counts inside it. */
  timeWindow?: TimeWindow;
  className?: string;
}

const MODE_TITLES: Record<ScopeMode, string> = {
  full: "Every fragment, in full",
  summaries:
    "Every fragment as a summary, pinned items in full; the model reads fragments on demand",
  off: "Pinned items only",
};

/**
 * The context selector: a slim row above the composer with the scope mode
 * (Full / Summaries / Off) and pinned items, together deciding what the next
 * turn reads. Selection logic lives in `state.ts`; this component is stateless
 * with respect to the selection — it derives everything from `items` and emits
 * via `onChange`.
 */
export function ContextBar({
  items,
  onChange,
  entity = "chat",
  timeWindow,
  className,
}: ContextBarProps) {
  const sources = useContextSources();
  const [open, setOpen] = useState(false);
  const [pinQuery, setPinQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const state = deriveBarState(items);
  const fit = useWholeScopeFits(timeWindow);
  const blocked = fullBlockedBy(state, fit.fits);
  // Refinement chat has no summaries legend, digest or read tools yet, and
  // its apply leg always reads full bodies — so the mode is chat-only.
  const summariesAvailable = entity === "chat";
  // Content pins are redundant with Full; the picker withholds them there.
  const contentPinsAllowed = state.mode !== "full";
  const canPin = contentPinsAllowed || allowsSources(entity);

  // A Full selection the model cannot take is a dead end (the send 422s), so
  // where Summaries exists the bar moves there itself.
  useEffect(() => {
    if (blocked === "size" && state.mode === "full" && summariesAvailable) {
      onChange(setScopeMode(items, "summaries"));
    }
  }, [blocked, state.mode, summariesAvailable, items, onChange]);

  const fragmentSearch = useFragmentSearch(
    open && contentPinsAllowed ? pinQuery : "",
  );
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
    const matches = (name: string) => !q || name.toLowerCase().includes(q);

    const offer = (item: ContextItem, meta: string) => {
      const key = `${item.kind}:${item.id}`;
      if (pinned.has(key)) return;
      itemByKey.set(key, item);
      const option: PickerOption = { id: key, label: item.label, meta };
      if (item.value != null) option.value = item.value;
      options.push(option);
    };

    if (contentPinsAllowed) {
      for (const c of sources.colours
        .filter((o) => matches(o.name))
        .slice(0, MAX_PER_KIND)) {
        offer(
          { kind: "Colour", id: c.id, label: c.name, value: c.value },
          "colour",
        );
      }
    }
    if (allowsSources(entity)) {
      for (const p of sources.projections
        .filter((o) => matches(o.name))
        .slice(0, MAX_PER_KIND)) {
        offer({ kind: "Projection", id: p.id, label: p.name }, "projection");
      }
      for (const r of sources.reflections
        .filter((o) => matches(o.name))
        .slice(0, MAX_PER_KIND)) {
        offer({ kind: "Reflection", id: r.id, label: r.name }, "reflection");
      }
    }
    if (contentPinsAllowed) {
      for (const f of fragmentSearch.options) {
        offer({ kind: "Fragment", id: f.id, label: f.label }, f.meta ?? "");
      }
    }
    return { options, itemByKey };
  }, [
    entity,
    sources,
    fragmentSearch.options,
    state.pins,
    pinQuery,
    contentPinsAllowed,
  ]);

  // Pins can arrive as bare ids (a stored spec holds nothing else) — resolve
  // display labels against the loaded catalogues, falling back to the label
  // the item was created with.
  function pinLabel(pin: ContextItem): string {
    switch (pin.kind) {
      case "Fragment":
        return fragmentLabels.get(pin.id) ?? pin.label;
      case "Colour":
        return sources.colours.find((o) => o.id === pin.id)?.name ?? pin.label;
      case "Projection":
        return (
          sources.projections.find((o) => o.id === pin.id)?.name ?? pin.label
        );
      case "Reflection":
        return (
          sources.reflections.find((o) => o.id === pin.id)?.name ?? pin.label
        );
      default:
        return pin.label;
    }
  }

  function pinSwatch(pin: ContextItem): string | undefined {
    if (pin.kind !== "Colour") return undefined;
    return sources.colours.find((o) => o.id === pin.id)?.value ?? pin.value;
  }

  function closePanel() {
    setOpen(false);
    setPinQuery("");
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPinQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function modeTitle(mode: ScopeMode): string {
    if (mode === "full") {
      if (blocked === "pins")
        return "Pinned fragments and colours are already in full — unpin them to read everything in full";
      if (blocked === "size" && fit.totalTokens != null && fit.limit != null)
        return `Whole scope is about ${humanTokens(fit.totalTokens)} tokens; ${fit.model ?? "the model"} accepts about ${humanTokens(fit.limit)}`;
    }
    if (mode === "summaries" && !summariesAvailable)
      return "Not available for refinement yet";
    return MODE_TITLES[mode];
  }

  function modeDisabled(mode: ScopeMode): boolean {
    if (mode === "full") return blocked !== null && state.mode !== "full";
    if (mode === "summaries") return !summariesAvailable;
    return false;
  }

  const fullLabel =
    fit.totalTokens != null
      ? `Full · ~${humanTokens(fit.totalTokens)}`
      : "Full";

  const emptyCopy = !contentPinsAllowed
    ? allowsSources(entity)
      ? "Search projections and reflections by name. Fragments and colours are already in full — switch to Summaries or Off to pin one."
      : "Every fragment is already in full — switch to Off to pin specific fragments."
    : allowsSources(entity)
      ? "Search fragments by content, or colours, projections and reflections by name."
      : "Search fragments by content, or colours by name (a reflection reads fragments only).";

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative shrink-0 border-t border-line px-4 py-2",
        className,
      )}
    >
      {open && (
        <div className="absolute inset-x-2 bottom-full z-10 mb-1">
          <ItemPicker
            kindLabel="Item"
            tint="section"
            options={pinChoices.options}
            remoteFiltered
            loading={fragmentSearch.loading}
            onQueryChange={setPinQuery}
            onPick={(o) => {
              const item = pinChoices.itemByKey.get(o.id);
              if (item) onChange(addPin(items, item));
              closePanel();
            }}
            onClose={closePanel}
            emptyCopy={emptyCopy}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <fieldset
          aria-label="Scope"
          className="m-0 flex shrink-0 items-center border-0 p-0"
        >
          {(
            [
              ["full", fullLabel],
              ["summaries", "Summaries"],
              ["off", "Off"],
            ] as const
          ).map(([mode, label]) => (
            <ModeButton
              key={mode}
              label={label}
              active={state.mode === mode}
              disabled={modeDisabled(mode)}
              warn={
                mode === "full" && state.mode === "full" && blocked === "size"
              }
              title={modeTitle(mode)}
              onClick={() => onChange(setScopeMode(items, mode))}
            />
          ))}
        </fieldset>
        <button
          type="button"
          aria-expanded={open}
          disabled={!canPin}
          title={
            canPin
              ? "Pin a specific item to read in full"
              : "Every fragment is already in full — switch to Off to pin specific fragments"
          }
          onClick={() => {
            setPinQuery("");
            setOpen(!open);
          }}
          className={cn(
            "shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-pill font-bold uppercase disabled:opacity-40",
            open
              ? "border-section-edge bg-section-wash text-section-ink"
              : "border-line-strong text-fg-4 hover:text-fg-2",
          )}
        >
          + Pin
        </button>
        {state.pins.map((pin) => (
          <button
            key={`${pin.kind}:${pin.id}`}
            type="button"
            title="Remove from context"
            onClick={() => onChange(removePin(items, pin))}
            className="flex min-w-0 items-center gap-1 rounded-none border border-section-edge px-1.5 py-0.5 font-mono text-pill font-semibold text-section-ink hover:opacity-80"
          >
            <span className="shrink-0 uppercase">{KIND_ABBREV[pin.kind]}</span>
            {pinSwatch(pin) != null && (
              <ColourSwatch value={pinSwatch(pin) as string} size={8} />
            )}
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

function ModeButton({
  label,
  active,
  disabled,
  warn,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  /** Selected but known not to fit — flagged rather than disabled. */
  warn: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-pill font-bold uppercase -ml-px first:ml-0 disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-section-edge bg-section-wash text-section-ink"
          : "border-line-strong text-fg-4 hover:text-fg-2",
        warn && "border-destructive text-destructive",
      )}
    >
      {label}
    </button>
  );
}
