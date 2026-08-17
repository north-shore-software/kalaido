import { useMemo } from "react";
import { FRAGMENT_TYPE_OPTIONS, type FragmentTypeOption } from "@/lib/labels";
import { useCollection } from "@/hooks/use-collection";

/** A pickable item identified by record id (projections, colours). */
export interface ContextOption {
  id: string;
  name: string;
  /** A colour's visual value (tailwind class / hex / css colour) — colours only. */
  value?: string;
}

export interface ContextSources {
  /** Fragment types — a fixed enum, available synchronously. */
  types: FragmentTypeOption[];
  projections: ContextOption[];
  reflections: ContextOption[];
  colours: ContextOption[];
  loading: boolean;
  error: Error | null;
}

// The choices the context picker offers: fragment types (a static enum),
// projections, and colours. Projections and colours are small enough to hold
// client-side, so we load the full lists once (cached per kalaidoscope by
// useCollection). We deliberately fetch only `id,name` and never load fragments —
// resolving a selection to fragment ids happens only at generation time, elsewhere.
export function useContextSources(): ContextSources {
  const fragments = useCollection("fragment", { fields: "type" });
  // Deliberately unfiltered on name: an unnamed projection is still a thing you
  // can pin, and a context_spec that already references one has to be able to
  // resolve it back to a label — otherwise the summary falls through to the id.
  const projections = useCollection("projection", {
    sort: "-updated",
    fields: "id,name",
  });
  const reflections = useCollection("reflection", {
    sort: "-updated",
    fields: "id,name",
  });
  const colours = useCollection("colour", {
    sort: "-created",
    fields: "id,name,colour_value",
  });

  // Name is optional on all three collections, and every other list in the app
  // renders a missing one as "Untitled <thing>". Resolve it here so the pickers
  // and the read-only summary agree instead of each inventing a fallback.
  const projectionOptions = useMemo<ContextOption[]>(
    () =>
      projections.records.map((r) => ({
        id: r.id,
        name: r.name || "Untitled projection",
      })),
    [projections.records],
  );
  const reflectionOptions = useMemo<ContextOption[]>(
    () =>
      reflections.records.map((r) => ({
        id: r.id,
        name: r.name || "Untitled reflection",
      })),
    [reflections.records],
  );
  const colourOptions = useMemo<ContextOption[]>(
    () =>
      colours.records.map((r) => ({
        id: r.id,
        name: r.name || "Untitled colour",
        value: r.colour_value,
      })),
    [colours.records],
  );
  const typeOptions = useMemo<FragmentTypeOption[]>(() => {
    const existingTypes = new Set(fragments.records.map((f) => f.type));
    return FRAGMENT_TYPE_OPTIONS.filter((option) =>
      existingTypes.has(option.value),
    );
  }, [fragments.records]);

  return {
    types: typeOptions,
    projections: projectionOptions,
    reflections: reflectionOptions,
    colours: colourOptions,
    loading:
      fragments.isLoading ||
      projections.isLoading ||
      reflections.isLoading ||
      colours.isLoading,
    error:
      fragments.error ??
      projections.error ??
      reflections.error ??
      colours.error ??
      null,
  };
}
