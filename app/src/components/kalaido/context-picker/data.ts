import { useMemo } from "react";

import { useCollection } from "@/hooks/use-collection";
import { fragmentLabel } from "@/hooks/use-fragment-labels";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import type { PickerOption } from "./item-picker";

/** Below this a search matches too much to be worth sending. */
const MIN_QUERY = 2;

/**
 * Fragments matching a search, as picker options.
 *
 * The context sources deliberately never load the fragment collection — it is
 * unbounded and its rows have no names — so fragments are the one kind that
 * cannot be browsed, only searched. Labels are the opening line of the content,
 * the same convention `useFragmentLabels` uses everywhere else.
 */
export function useFragmentSearch(query: string): {
  options: PickerOption[];
  loading: boolean;
} {
  const client = useKalaidoscopeClient();
  const trimmed = query.trim();

  const filter = useMemo(() => {
    if (trimmed.length < MIN_QUERY) return undefined;
    return client.filter("content ~ {:q}", { q: trimmed });
  }, [trimmed, client]);

  const { records, isLoading } = useCollection("fragment", {
    filter,
    fields: "id,content,type",
    enabled: !!filter,
  });

  const options = useMemo(
    () =>
      records.slice(0, 30).map((r) => ({
        id: r.id,
        label: fragmentLabel(r.content),
        meta: r.type,
      })),
    [records],
  );

  return { options, loading: !!filter && isLoading };
}
