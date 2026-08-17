import { useEffect, useMemo, useRef, useState } from "react";

import { itemsToSpec } from "@/api/kalaidoscope/chat";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { resolveContextTokens } from "@/api/kalaidoscope/context";
import { useCollection } from "@/hooks/use-collection";
import { fragmentLabel } from "@/hooks/use-fragment-labels";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { FRAGMENT_TYPE_OPTIONS } from "@/lib/labels";
import type { PickerOption } from "./item-picker";

export interface ScopeTypeRow {
  value: string;
  label: string;
  count: number;
  /** Null until priced — never zero as a stand-in. */
  tokens: number | null;
}

export interface ScopeSummary {
  rows: ScopeTypeRow[];
  totalFragments: number;
  totalTokens: number | null;
  /** Fragments per type, for pricing criteria without a second round trip. */
  countByType: Map<string, number>;
  loading: boolean;
}

/**
 * What the whole kalaidoscope holds, before any of the funnel narrows it.
 *
 * Counts come from the fragment collection, which is already loaded for the type
 * list. Token sizes come from the same endpoint the readout uses: every fragment
 * has exactly one type, so pricing each type in one call both fills the per-type
 * rows and sums to the scope total.
 */
export function useScopeSummary(): ScopeSummary {
  const fragments = useCollection("fragment", { fields: "type" });
  const [tokensByType, setTokensByType] = useState<Record<string, number>>({});

  const countByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fragments.records) {
      m.set(f.type, (m.get(f.type) ?? 0) + 1);
    }
    return m;
  }, [fragments.records]);

  // Stable across renders so the effect fires once per real change of scope.
  const presentTypes = useMemo(
    () => [...countByType.keys()].sort().join(","),
    [countByType],
  );

  useEffect(() => {
    if (!presentTypes) return;
    let active = true;
    void (async () => {
      try {
        const res = await resolveContextTokens({
          fragmentTypes: presentTypes.split(","),
        });
        if (!active) return;
        const out: Record<string, number> = {};
        for (const [key, n] of Object.entries(res.breakdown)) {
          const [kind, ...rest] = key.split(":");
          if (kind === "Type") out[rest.join(":")] = n;
        }
        setTokensByType(out);
      } catch (err) {
        // A missing size degrades to "—", which is why nothing here throws.
        console.error(err);
      }
    })();
    return () => {
      active = false;
    };
  }, [presentTypes]);

  const rows = useMemo(
    () =>
      FRAGMENT_TYPE_OPTIONS.filter((o) => countByType.has(o.value)).map(
        (o) => ({
          value: o.value,
          label: o.label,
          count: countByType.get(o.value) ?? 0,
          tokens: tokensByType[o.value] ?? null,
        }),
      ),
    [countByType, tokensByType],
  );

  const priced = rows.filter((r) => r.tokens != null);

  return {
    rows,
    totalFragments: fragments.records.length,
    totalTokens:
      priced.length === rows.length && rows.length > 0
        ? priced.reduce((n, r) => n + (r.tokens ?? 0), 0)
        : null,
    countByType,
    loading: fragments.isLoading,
  };
}

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

/**
 * The key the token endpoint reports a contributor under. Everything is
 * `Kind:id` except the whole-scope marker, which the endpoint reports as the
 * bare `WholeScope` — so the local prices have to be keyed the same way, or that
 * entry is never recognised as already priced.
 */
function tokenKey(it: ContextItem): string {
  return it.kind === "WholeScope" ? "WholeScope" : `${it.kind}:${it.id}`;
}

export interface ResolvedTokens {
  totalTokens: number | null;
  /** Breakdown keys as the endpoint returns them: `Kind:id`. */
  breakdown: Record<string, number>;
}

/** The prices this selection needs, keyed as the endpoint reports them. */
function neededKeys(items: ContextItem[]): string[] {
  // An empty selection still resolves to the whole scope (see `itemsToSpec`),
  // so it needs that one entry rather than none.
  return items.length === 0 ? ["WholeScope"] : items.map(tokenKey);
}

/**
 * Price a selection, reusing what has already been priced.
 *
 * The endpoint prices each contributor separately and returns them keyed
 * `Kind:id`, so a selection that grows by one item costs one item's worth of
 * work rather than a re-price of the whole set.
 */
export function useResolvedTokens(items: ContextItem[]): ResolvedTokens {
  // Prices already known. State rather than a ref so everything derived from it
  // recomputes when a fetch lands — behind a ref the arrival is invisible, and
  // the total silently never updates.
  const [priced, setPriced] = useState<Record<string, number>>({});

  // Keys already asked for. The effect both reads and writes `priced`, so
  // without this a key the endpoint never returns would be requested again on
  // every landing — a quiet request loop. On failure the keys are released so a
  // later change to the selection can retry.
  const requested = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missing = neededKeys(items).filter(
      (k) => priced[k] === undefined && !requested.current.has(k),
    );
    if (missing.length === 0) return;
    for (const k of missing) requested.current.add(k);

    let active = true;
    const merge = (b: Record<string, number>) => {
      if (active) setPriced((p) => ({ ...p, ...b }));
    };
    const release = (err: unknown) => {
      console.error(err);
      for (const k of missing) requested.current.delete(k);
    };

    // The base and the item-level contributors have to be priced in separate
    // calls: the endpoint short-circuits a whole-scope spec and reports only
    // that one total, ignoring any sources attached to it. Sending them
    // together would leave every source permanently unpriced.
    if (missing.includes("WholeScope")) {
      void resolveContextTokens({ wholeScope: true })
        .then((res) => merge(res.breakdown))
        .catch(release);
    }

    const missingItems = items.filter(
      (it) => it.kind !== "WholeScope" && missing.includes(tokenKey(it)),
    );
    if (missingItems.length > 0) {
      void resolveContextTokens(itemsToSpec(missingItems))
        .then((res) => merge(res.breakdown))
        .catch(release);
    }

    return () => {
      active = false;
    };
  }, [items, priced]);

  const breakdown = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of neededKeys(items)) {
      const n = priced[k];
      if (n !== undefined) out[k] = n;
    }
    return out;
  }, [items, priced]);

  // Null until every contributor is priced. A partial sum would understate the
  // spec, and understating the size is the one error a headroom readout must
  // never make — it would report "fits" for something that does not.
  const totalTokens = useMemo(() => {
    const keys = neededKeys(items);
    if (!keys.every((k) => priced[k] !== undefined)) return null;
    return keys.reduce((n, k) => n + (priced[k] ?? 0), 0);
  }, [items, priced]);

  return { totalTokens, breakdown };
}
