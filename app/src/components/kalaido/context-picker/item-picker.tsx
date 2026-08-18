import { useMemo, useState } from "react";
import { cn } from "@/lib/css-utils";
import { ColourSwatch } from "../colour";

/** Which stage opened the picker — it borrows that stage's accent. */
export type PickerTint = "cyan" | "yellow";

const TINT: Record<PickerTint, { box: string; pill: string }> = {
  cyan: { box: "border-cyan", pill: "border-cyan-edge text-cyan-ink" },
  yellow: { box: "border-yellow", pill: "border-yellow-line text-yellow-ink" },
};

export interface PickerOption {
  id: string;
  label: string;
  /** A colour's stored value — renders a swatch ahead of the label. */
  value?: string;
  /** Right-aligned mono detail: a count, a type, a recency. */
  meta?: string;
}

interface ItemPickerProps {
  /** Rendered in the pill and woven into the placeholder. */
  kindLabel: string;
  tint: PickerTint;
  /** Already filtered down to what is not selected. */
  options: PickerOption[];
  onPick: (option: PickerOption) => void;
  onClose: () => void;
  /** Shown instead of the list when nothing matches. */
  emptyCopy: string;
  /**
   * Offered under the empty copy when the shortage is of *vocabulary* rather
   * than of matches — i.e. the user has no colours to filter with.
   */
  onAutoSegment?: () => void;
  loading?: boolean;
  /** Notified as the user types, for pickers that search server-side. */
  onQueryChange?: (query: string) => void;
  /** Set when `options` are already filtered upstream — skips local matching. */
  remoteFiltered?: boolean;
}

/**
 * The search surface shared by all three stages. Search-first: it opens focused
 * on the input, commits the top match on Enter, and closes on Escape, so a
 * criterion can be added without the pointer ever moving.
 */
export function ItemPicker({
  kindLabel,
  tint,
  options,
  onPick,
  onClose,
  emptyCopy,
  onAutoSegment,
  loading,
  onQueryChange,
  remoteFiltered,
}: ItemPickerProps) {
  const [query, setQuery] = useState("");
  const t = TINT[tint];

  const rows = useMemo(() => {
    if (remoteFiltered) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, remoteFiltered]);

  return (
    <div className={cn("border bg-surface-1", t.box)}>
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <span
          className={cn(
            "shrink-0 border px-1.5 py-0.5 font-mono text-pill font-bold uppercase",
            t.pill,
          )}
        >
          {kindLabel}
        </span>
        <input
          // The picker exists only while open, and it is opened by an explicit
          // "+ …" press — landing the caret anywhere else would make every add
          // a two-step action.
          // biome-ignore lint/a11y/noAutofocus: search-first is the point
          autoFocus
          value={query}
          placeholder={`Search ${kindLabel.toLowerCase()}s…`}
          onChange={(e) => {
            setQuery(e.target.value);
            onQueryChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
            if (e.key === "Enter" && rows[0]) {
              e.preventDefault();
              onPick(rows[0]);
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-fg-1 outline-none placeholder:text-fg-5"
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 border border-line-strong px-1.5 py-0.5 font-mono text-pill font-semibold uppercase text-fg-5 hover:text-fg-3"
        >
          Esc
        </button>
      </div>

      {rows.length > 0 && (
        <div className="max-h-44 overflow-y-auto">
          {rows.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o)}
              className="flex w-full items-center gap-2.5 border-0 border-b border-line px-3 py-2.5 text-left hover:bg-surface-2"
            >
              {o.value != null && <ColourSwatch value={o.value} size={9} />}
              <span className="min-w-0 truncate text-item font-semibold text-fg-1">
                {o.label}
              </span>
              {o.meta && (
                <span className="ml-auto shrink-0 font-mono text-mono-sm text-fg-4">
                  {o.meta}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 && (
        <div className="px-3 py-3.5">
          {loading ? (
            <p className="font-mono text-mono-sm text-fg-5">Searching…</p>
          ) : (
            <>
              <p className="mb-2.5 text-meta text-fg-4 text-pretty">
                {emptyCopy}
              </p>
              {onAutoSegment && (
                <button
                  type="button"
                  onClick={onAutoSegment}
                  className="w-full border border-cyan px-3 py-2.5 text-btn-sm font-bold uppercase text-cyan-ink hover:opacity-85"
                >
                  Auto-segment my scope
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
