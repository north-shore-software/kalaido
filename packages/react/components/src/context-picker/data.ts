import { toError } from "@kalaido/client/lib/errors";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import { fragmentLabel } from "@kalaido/hooks/use-fragment-labels";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { httpLiveSource, useLiveRead } from "@kalaido/state/live";
import { err, ok } from "neverthrow";
import { useEffect, useMemo, useState } from "react";
import type { PickerOption } from "./item-picker";

/** Below this a search matches too much to be worth sending. */
const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 200;

interface FragmentSearchRow {
  id: string;
  content: string;
  type: string;
}

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
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) {
      setDebounced("");
      return;
    }
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const activeQuery = trimmed.length >= MIN_QUERY ? debounced : "";

  const source = useMemo(
    () =>
      httpLiveSource<FragmentSearchRow[]>({
        key: activeQuery
          ? ["pb", client.baseURL, "fragment-search", activeQuery]
          : null,
        tags: [kalaidoscopeCollectionTag(client.baseURL, "fragment")],
        fetch: async () => {
          try {
            const page = await client.collection("fragment").getList(1, 30, {
              filter: client.filter("content ~ {:q}", { q: activeQuery }),
              fields: "id,content,type",
              requestKey: null,
            });
            return ok(page.items as unknown as FragmentSearchRow[]);
          } catch (e) {
            return err(toError(e));
          }
        },
      }),
    [client, activeQuery],
  );

  const read = useLiveRead(source);

  const options = useMemo(
    () =>
      (read.data ?? []).map((r) => ({
        id: r.id,
        label: fragmentLabel(r.content),
        meta: r.type,
      })),
    [read.data],
  );

  const loading =
    trimmed.length >= MIN_QUERY && (debounced !== trimmed || read.isLoading);

  return { options, loading };
}
