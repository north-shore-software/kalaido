import { useMemo } from "react";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { useFragmentSearch } from "@/components/kalaido/context-picker/data";
import { useContextSources } from "@/hooks/use-context-sources";
import { cn } from "@/lib/css-utils";
import { ColourSwatch } from "./colour";

export interface MentionOption {
  item: ContextItem;
  /** Right-aligned mono detail: the kind, or a fragment's type. */
  meta: string;
}

/** Per kind, so one prolific kind can't crowd the others out of the menu. */
const MAX_PER_KIND = 5;

/**
 * The entities an @-mention can resolve to, filtered by the typed query.
 * Colours, types, projections and reflections are the client-side lists the
 * context picker already loads; fragments are the one kind that can only be
 * searched server-side (they are unbounded and have no names), so they appear
 * once the query is long enough for `useFragmentSearch` to fire.
 */
export function useMentionOptions(
  query: string,
  enabled: boolean,
): { options: MentionOption[]; loading: boolean } {
  const sources = useContextSources();
  const fragments = useFragmentSearch(enabled ? query : "");

  const options = useMemo<MentionOption[]>(() => {
    if (!enabled) return [];
    const q = query.trim().toLowerCase();
    const matches = (label: string) => !q || label.toLowerCase().includes(q);

    const out: MentionOption[] = [];
    for (const c of sources.colours
      .filter((c) => matches(c.name))
      .slice(0, MAX_PER_KIND)) {
      out.push({
        item: { kind: "Colour", id: c.id, label: c.name, value: c.value },
        meta: "colour",
      });
    }
    for (const t of sources.types
      .filter((t) => matches(t.label))
      .slice(0, MAX_PER_KIND)) {
      out.push({
        item: { kind: "Type", id: t.value, label: t.label },
        meta: "type",
      });
    }
    for (const p of sources.projections
      .filter((p) => matches(p.name))
      .slice(0, MAX_PER_KIND)) {
      out.push({
        item: { kind: "Projection", id: p.id, label: p.name },
        meta: "projection",
      });
    }
    for (const r of sources.reflections
      .filter((r) => matches(r.name))
      .slice(0, MAX_PER_KIND)) {
      out.push({
        item: { kind: "Reflection", id: r.id, label: r.name },
        meta: "reflection",
      });
    }
    // Already server-filtered; labels are first lines, not names, so no local match.
    for (const f of fragments.options.slice(0, MAX_PER_KIND)) {
      out.push({
        item: { kind: "Fragment", id: f.id, label: f.label },
        meta: f.meta ?? "fragment",
      });
    }
    return out;
  }, [enabled, query, sources, fragments.options]);

  return { options, loading: enabled && fragments.loading };
}

interface MentionMenuProps {
  options: MentionOption[];
  activeIndex: number;
  onPick: (option: MentionOption) => void;
  onHover: (index: number) => void;
  loading?: boolean;
}

/**
 * The @-mention dropdown: purely presentational — the composer owns the query,
 * the highlight and every key press, so its Enter-to-submit handler can
 * arbitrate between accepting a mention and sending the message.
 */
export function MentionMenu({
  options,
  activeIndex,
  onPick,
  onHover,
  loading,
}: MentionMenuProps) {
  return (
    <div className="absolute inset-x-0 bottom-full z-10 mb-2 border border-line-strong bg-surface-1">
      <div className="max-h-56 overflow-y-auto">
        {options.map((o, i) => (
          <button
            key={`${o.item.kind}:${o.item.id}`}
            type="button"
            // The textarea must keep focus; a click still picks via onClick.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(o)}
            onMouseEnter={() => onHover(i)}
            className={cn(
              "flex w-full items-center gap-2.5 border-0 border-b border-line px-3 py-2 text-left",
              i === activeIndex && "bg-surface-2",
            )}
          >
            {o.item.value != null && (
              <ColourSwatch value={o.item.value} size={9} />
            )}
            <span className="min-w-0 truncate text-item font-semibold text-fg-1">
              {o.item.label}
            </span>
            <span className="ml-auto shrink-0 font-mono text-mono-sm uppercase text-fg-4">
              {o.meta}
            </span>
          </button>
        ))}
      </div>
      {loading && (
        <p className="px-3 py-2 font-mono text-mono-sm text-fg-5">Searching…</p>
      )}
    </div>
  );
}
