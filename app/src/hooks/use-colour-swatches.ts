import { useMemo } from "react";
import { useCollection } from "@/hooks/use-collection";

/** Colour id → palette slot, for resolving a `view_stream.colour_ids` cell. */
export function useColourSwatches(): Map<string, number> {
  const colours = useCollection("colour", { fields: "id,swatch" });
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const c of colours.records) m.set(c.id, c.swatch ?? 0);
    return m;
  }, [colours.records]);
}

/** Parse a `view_stream.colour_ids` cell (JSON string or array) to colour ids. */
export function parseColourIds(raw: unknown): string[] {
  let ids: unknown = raw;
  if (typeof raw === "string") {
    try {
      ids = JSON.parse(raw);
    } catch {
      ids = [];
    }
  }
  return Array.isArray(ids) ? ids.map(String) : [];
}

/**
 * Resolve a `view_stream.colour_ids` cell to swatches. A colour that no
 * longer exists is dropped.
 */
export function resolveSwatches(
  raw: unknown,
  swatches: Map<string, number>,
): number[] {
  return parseColourIds(raw).flatMap((id) => {
    const s = swatches.get(id);
    return s == null ? [] : [s];
  });
}
