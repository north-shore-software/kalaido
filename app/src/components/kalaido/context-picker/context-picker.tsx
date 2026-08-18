import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PaneHeader } from "@/components/layout/page-chrome";
import { cn } from "@/lib/css-utils";
import { useContextSources } from "@/hooks/use-context-sources";
import { useFragmentLabelsQuery } from "@/hooks/use-fragment-labels";
import { ColourSwatch } from "../colour";
import { Mono } from "../text";
import { useFragmentSearch, useResolvedTokens, useScopeSummary } from "./data";
import { ItemPicker, type PickerOption, type PickerTint } from "./item-picker";
import { type Contributor, ResolutionReadout } from "./resolution-readout";
import {
  DEFAULT_LAST_N,
  itemsKey,
  itemsToSelection,
  sameRef,
  selectionToItems,
} from "./selection";
import {
  type ContextItem,
  type ContextSelection,
  type CriterionKind,
  EMPTY_SELECTION,
  type EntityKind,
  type FocusKind,
  type FragmentMode,
  type LastN,
  type SourceKind,
  allowsSources,
} from "./types";

const MODE_LABEL: Record<FragmentMode, string> = {
  except: "Everything, except…",
  only: "Only…",
  none: "None",
};

/**
 * Empty-state copy states the consequence rather than the absence. "Nothing
 * excluded" and "nothing included" are the same fact about the list and
 * opposite facts about the resolved set, and the resolved set is what the user
 * is actually choosing.
 */
const EMPTY_CRITERIA_COPY: Record<FragmentMode, string> = {
  except: "Nothing excluded — this means everything",
  only: "Nothing included — this resolves to nothing",
  none: "No raw material — built only from the syntheses below",
};

const ENTITY_LABEL: Record<EntityKind, string> = {
  projection: "Editing a Projection",
  reflection: "Editing a Reflection",
  chat: "Editing a Chat",
};

const KIND_ABBREV: Record<string, string> = {
  Colour: "Colour",
  Type: "Type",
  Fragment: "Frag",
  Projection: "Proj",
  Reflection: "Refl",
};

const LAST_N_OPTIONS: LastN[] = [1, 7, 30, "all"];

const fmtCount = (n: number) => n.toLocaleString("en-US");

export interface ContextPickerProps {
  /** The current selection. The picker stays in sync with it — no remount needed. */
  value?: ContextItem[];
  onChange?: (values: ContextItem[]) => void;
  /**
   * Which sort of entity is being given a context. Decides which stages exist:
   * a Reflection is a leaf node, so it has no "Build on top of" stage and no
   * fragment-free mode.
   */
  entity?: EntityKind;
  /** Drop the pane chrome — for a host that supplies its own frame. */
  flush?: boolean;
  className?: string;
}

export function ContextPicker({
  value,
  onChange,
  entity = "projection",
  flush,
  className,
}: ContextPickerProps) {
  const [selection, setSelection] = useState<ContextSelection>(() =>
    value ? itemsToSelection(value) : EMPTY_SELECTION,
  );
  const [picker, setPicker] = useState<{
    slot: "criteria" | "source" | "focus";
    kind: string;
  } | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [fragmentQuery, setFragmentQuery] = useState("");

  const sources = useContextSources();
  const scope = useScopeSummary();
  const fragmentSearch = useFragmentSearch(fragmentQuery);

  const items = useMemo(() => selectionToItems(selection), [selection]);
  const resolved = useResolvedTokens(items);

  // Stay in sync with the prop without a remount. Only the wire-visible content
  // is compared: `mode` and `Last N` never reach the prop, so a difference in
  // them can never mean the prop changed underneath us.
  const emittedRef = useRef(itemsKey(items));
  useEffect(() => {
    if (!value) return;
    const incoming = itemsKey(value);
    if (incoming === emittedRef.current) return;
    emittedRef.current = incoming;
    setSelection(itemsToSelection(value));
  }, [value]);

  const commit = (next: ContextSelection) => {
    setSelection(next);
    const nextItems = selectionToItems(next);
    emittedRef.current = itemsKey(nextItems);
    onChange?.(nextItems);
  };

  const sourcesAllowed = allowsSources(entity);
  const mode: FragmentMode =
    selection.mode === "none" && !sourcesAllowed ? "except" : selection.mode;
  const modes: FragmentMode[] = sourcesAllowed
    ? ["except", "only", "none"]
    : ["except", "only"];

  /* ---------------------------------------------------------------- labels */

  // Stored specs hold ids only, so anything reconstructed from one arrives
  // labelled with its id. Resolve against the catalogue the picker already
  // loads; anything unknown keeps what it came with rather than vanishing.
  const catalogue = useMemo(() => {
    const m = new Map<string, { label: string; value?: string }>();
    for (const c of sources.colours)
      m.set(`Colour:${c.id}`, { label: c.name, value: c.value });
    for (const t of sources.types) m.set(`Type:${t.value}`, { label: t.label });
    for (const p of sources.projections)
      m.set(`Projection:${p.id}`, { label: p.name });
    for (const r of sources.reflections)
      m.set(`Reflection:${r.id}`, { label: r.name });
    return m;
  }, [sources]);

  const fragmentIds = useMemo(
    () => [
      ...selection.criteria
        .filter((c) => c.kind === "Fragment")
        .map((c) => c.id),
      ...selection.focus.filter((f) => f.kind === "Fragment").map((f) => f.id),
    ],
    [selection],
  );
  const { labels: fragmentLabels, ready: labelsReady } =
    useFragmentLabelsQuery(fragmentIds);

  const label = useCallback(
    (kind: string, id: string, fallback: string) => {
      if (kind === "Fragment") return fragmentLabels.get(id) ?? fallback;
      return catalogue.get(`${kind}:${id}`)?.label ?? fallback;
    },
    [catalogue, fragmentLabels],
  );

  /* ------------------------------------------------------------ resolution */

  const contributors: Contributor[] = useMemo(
    () =>
      Object.entries(resolved.breakdown).map(([key, tokens]) => {
        if (key === "WholeScope") return { name: "Whole scope", tokens };
        const [kind, ...rest] = key.split(":");
        const id = rest.join(":");
        return {
          name: `${KIND_ABBREV[kind] ?? kind}: ${label(kind, id, id)}`,
          tokens,
        };
      }),
    [resolved.breakdown, label],
  );

  // How many fragments the spec resolves to, where that is knowable. A colour
  // criterion makes it unknowable client-side (the fragment↔colour join is not
  // loaded), and an unknown count is rendered as absent rather than guessed.
  const fragmentCount = useMemo(() => {
    if (mode === "none") return 0;
    if (mode === "except") return scope.totalFragments;
    if (selection.criteria.some((c) => c.kind === "Colour")) return null;
    let n = 0;
    for (const c of selection.criteria) {
      if (c.kind === "Type") n += scope.countByType.get(c.id) ?? 0;
      if (c.kind === "Fragment") n += 1;
    }
    return n;
  }, [mode, selection.criteria, scope]);

  /* --------------------------------------------------------------- actions */

  const setMode = (next: FragmentMode) => commit({ ...selection, mode: next });

  const removeCriterion = (id: string, kind: string) =>
    commit({
      ...selection,
      criteria: selection.criteria.filter((c) => !sameRef(c, { kind, id })),
    });

  const removeSource = (id: string, kind: string) =>
    commit({
      ...selection,
      sources: selection.sources.filter((s) => !sameRef(s, { kind, id })),
    });

  const removeFocus = (id: string, kind: string) =>
    commit({
      ...selection,
      focus: selection.focus.filter((f) => !sameRef(f, { kind, id })),
    });

  const setLastN = (id: string, n: LastN) =>
    commit({
      ...selection,
      sources: selection.sources.map((s) =>
        s.kind === "Reflection" && s.id === id ? { ...s, lastN: n } : s,
      ),
    });

  const closePicker = () => {
    setPicker(null);
    setFragmentQuery("");
  };

  const pick = (option: PickerOption) => {
    if (!picker) return;
    const kind = picker.kind;
    if (picker.slot === "criteria") {
      commit({
        ...selection,
        criteria: [
          ...selection.criteria,
          {
            kind: kind as CriterionKind,
            id: option.id,
            label: option.label,
            value: option.value,
          },
        ],
      });
    } else if (picker.slot === "source") {
      commit({
        ...selection,
        sources: [
          ...selection.sources,
          {
            kind: kind as SourceKind,
            id: option.id,
            label: option.label,
            ...(kind === "Reflection" ? { lastN: DEFAULT_LAST_N } : {}),
          },
        ],
      });
    } else {
      commit({
        ...selection,
        focus: [
          ...selection.focus,
          { kind: kind as FocusKind, id: option.id, label: option.label },
        ],
      });
    }
    closePicker();
  };

  /* --------------------------------------------------------- picker options */

  const pickerOptions: PickerOption[] = useMemo(() => {
    if (!picker) return [];
    const taken = new Set(
      (picker.slot === "criteria"
        ? selection.criteria
        : picker.slot === "source"
          ? selection.sources
          : selection.focus
      ).map((x) => `${x.kind}:${x.id}`),
    );
    const keep = (kind: string, id: string) => !taken.has(`${kind}:${id}`);

    switch (picker.kind) {
      case "Colour":
        return sources.colours
          .filter((c) => keep("Colour", c.id))
          .map((c) => ({ id: c.id, label: c.name, value: c.value }));
      case "Type":
        return sources.types
          .filter((t) => keep("Type", t.value))
          .map((t) => ({
            id: t.value,
            label: t.label,
            meta: `${fmtCount(scope.countByType.get(t.value) ?? 0)} frags`,
          }));
      case "Fragment":
        return fragmentSearch.options.filter((o) => keep("Fragment", o.id));
      case "Projection":
        return sources.projections
          .filter((p) => keep("Projection", p.id))
          .map((p) => ({ id: p.id, label: p.name }));
      case "Reflection":
        return sources.reflections
          .filter((r) => keep("Reflection", r.id))
          .map((r) => ({ id: r.id, label: r.name }));
      default:
        return [];
    }
  }, [picker, selection, sources, scope.countByType, fragmentSearch.options]);

  const pickerEmptyCopy = (() => {
    if (!picker) return "";
    if (picker.kind === "Colour") {
      return "Colours are how you filter semantically. If you haven't built any yet, let Kalaido read your material and propose a set.";
    }
    if (picker.kind === "Fragment") {
      return fragmentQuery.trim().length < 2
        ? "Fragments have no names, so they can only be searched. Type at least two characters."
        : "No fragment matches that.";
    }
    return "Nothing left to add here.";
  })();

  const pickerTint: PickerTint =
    picker?.slot === "source"
      ? "yellow"
      : picker?.slot === "focus"
        ? "magenta"
        : "cyan";

  const openPicker = (slot: "criteria" | "source" | "focus", kind: string) =>
    setPicker({ slot, kind });

  /* ------------------------------------------------------------ focus state */

  const focusRows = useMemo(
    () =>
      selection.focus.map((f) => {
        const name = label(f.kind, f.id, f.label);

        // A fragment id the lookup came back without has been deleted. Real,
        // not stubbed — and never dropped silently, because focus is the part
        // of the spec the user cares most about. Gated on `labelsReady` so an
        // in-flight lookup never reads as a deletion.
        if (f.kind === "Fragment" && labelsReady && !fragmentLabels.has(f.id)) {
          return {
            ...f,
            name,
            tone: "invalid" as const,
            state: "Invalid",
            reason:
              "Deleted from the workspace. Kept here rather than dropped quietly.",
            fix: "Remove",
            fixKind: "removeFocus" as const,
          };
        }

        if (f.kind === "Fragment") {
          if (mode === "none") {
            return {
              ...f,
              name,
              tone: "blocked" as const,
              state: "Blocked",
              reason: "No fragments in scope — Fragments is set to None.",
              fix: "Switch to Only…",
              fixKind: "switchToOnly" as const,
            };
          }
          const named = selection.criteria.some(
            (c) => c.kind === "Fragment" && c.id === f.id,
          );
          if (mode === "except" && named) {
            return {
              ...f,
              name,
              tone: "blocked" as const,
              state: "Blocked",
              reason: "You excluded this fragment.",
              fix: "Drop exclusion",
              fixKind: "dropExclusion" as const,
            };
          }
          if (mode === "only" && !named) {
            return {
              ...f,
              name,
              tone: "added" as const,
              state: "Adds to scope",
              reason:
                "Not named by Only include — focusing it adds it as an explicit fragment.",
              fix: "Undo",
              fixKind: "removeFocus" as const,
            };
          }
          return { ...f, name, tone: "ok" as const, state: "In scope" };
        }

        const composed = selection.sources.some((s) => sameRef(s, f));
        if (!composed) {
          return {
            ...f,
            name,
            tone: "added" as const,
            state: "Adds to scope",
            reason: `Not built on top of — focusing it adds it as a source ${f.kind.toLowerCase()}.`,
            fix: "Undo",
            fixKind: "removeFocus" as const,
          };
        }
        return { ...f, name, tone: "ok" as const, state: "In scope" };
      }),
    [selection, mode, fragmentLabels, labelsReady, label],
  );

  const applyFix = (row: FocusRowModel) => {
    switch (row.fixKind) {
      case "removeFocus":
        return removeFocus(row.id, row.kind);
      case "dropExclusion":
        return removeCriterion(row.id, "Fragment");
      case "switchToOnly":
        return setMode("only");
    }
  };

  /* ----------------------------------------------------------------- render */

  const criteriaAccent =
    mode === "except"
      ? {
          inset: "shadow-[inset_3px_0_0_var(--status-critical)]",
          pill: "border-critical/40 bg-critical-wash text-critical-ink",
        }
      : {
          inset: "shadow-[inset_3px_0_0_var(--section)]",
          pill: "border-section-edge bg-section-wash text-section-ink",
        };

  const body = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ---------------------------------------------- 01 Fragments ---- */}
        <section className="border-b border-line p-5">
          <button
            type="button"
            onClick={() => setScopeOpen(!scopeOpen)}
            className="flex w-full items-baseline gap-2.5 border-0 bg-transparent p-0 text-left hover:opacity-80"
          >
            <StageNumber n="01" />
            <span
              className={cn(
                "text-[9px] text-fg-5 transition-transform",
                !scopeOpen && "-rotate-90",
              )}
            >
              ▾
            </span>
            <span className="text-item font-bold text-fg-1">
              Kalaidoscope Fragments
            </span>
            <span className="ml-auto font-mono text-mono-sm text-fg-4">
              {fmtCount(scope.totalFragments)} fragments
            </span>
          </button>

          {scopeOpen && (
            <div className="mt-3 flex flex-col gap-1.5">
              {scope.rows.map((r) => (
                <div
                  key={r.value}
                  className="flex items-baseline gap-2.5 font-mono text-mono-sm"
                >
                  <span className="w-2 shrink-0 text-fg-5">—</span>
                  <span className="min-w-0 truncate text-fg-2">{r.label}</span>
                  <span className="ml-auto shrink-0 text-fg-3">
                    {fmtCount(r.count)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-fg-5">
                    {r.tokens == null ? "—" : fmtTokensShort(r.tokens)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="my-4 flex border border-line-strong">
            {modes.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  "flex-1 border-0 px-2 py-2.5 text-center text-body-sm font-semibold",
                  i > 0 && "border-l border-line-strong",
                  mode === m
                    ? "bg-section text-section-foreground"
                    : "bg-transparent text-fg-3 hover:text-fg-1",
                )}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          {mode !== "none" && (
            <>
              <div className="mb-2.5 flex flex-col gap-1.5">
                {selection.criteria.map((c) => {
                  const count =
                    c.kind === "Type"
                      ? `${mode === "except" ? "−" : ""}${fmtCount(scope.countByType.get(c.id) ?? 0)} frags`
                      : null;
                  return (
                    <div
                      key={`${c.kind}:${c.id}`}
                      className={cn(
                        "flex items-center gap-2.5 border border-line-strong bg-surface-1 px-3 py-2.5",
                        criteriaAccent.inset,
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 border px-1.5 py-0.5 font-mono text-pill font-bold uppercase",
                          criteriaAccent.pill,
                        )}
                      >
                        {KIND_ABBREV[c.kind]}
                      </span>
                      {c.kind === "Colour" && (
                        <ColourSwatch
                          value={catalogue.get(`Colour:${c.id}`)?.value}
                          size={9}
                        />
                      )}
                      <span className="min-w-0 truncate text-item font-semibold text-fg-1">
                        {label(c.kind, c.id, c.label)}
                      </span>
                      {count && (
                        <span className="ml-auto shrink-0 font-mono text-mono-sm text-fg-5">
                          {count}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeCriterion(c.id, c.kind)}
                        title="Remove"
                        className={cn(
                          "shrink-0 border-0 bg-transparent px-0 pl-1 font-mono text-item text-fg-5 hover:text-critical-ink",
                          !count && "ml-auto",
                        )}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              {selection.criteria.length === 0 && (
                <div className="mb-2.5 border border-dashed border-line-strong px-3 py-3 text-center font-mono text-mono-sm text-fg-5">
                  {EMPTY_CRITERIA_COPY[mode]}
                </div>
              )}

              <div className="flex gap-1.5">
                {(["Colour", "Type", "Fragment"] as const).map((k) => (
                  <Adder
                    key={k}
                    label={k}
                    tint="cyan"
                    onClick={() => openPicker("criteria", k)}
                  />
                ))}
              </div>
            </>
          )}

          {mode === "none" && (
            <div className="border border-dashed border-line-strong px-3 py-3 text-center font-mono text-mono-sm text-fg-5">
              {EMPTY_CRITERIA_COPY.none}
            </div>
          )}

          {picker?.slot === "criteria" && (
            <div className="mt-2.5">
              <ItemPicker
                kindLabel={picker.kind}
                tint={pickerTint}
                options={pickerOptions}
                onPick={pick}
                onClose={closePicker}
                emptyCopy={pickerEmptyCopy}
                loading={picker.kind === "Fragment" && fragmentSearch.loading}
                remoteFiltered={picker.kind === "Fragment"}
                onQueryChange={
                  picker.kind === "Fragment" ? setFragmentQuery : undefined
                }
                onAutoSegment={
                  picker.kind === "Colour" ? autoSegmentNotReady : undefined
                }
              />
            </div>
          )}
        </section>

        {/* ------------------------------------------ 02 Build on top of --- */}
        {sourcesAllowed ? (
          <section className="border-b border-line p-5">
            <div className="mb-2.5 flex items-baseline gap-2.5">
              <StageNumber n="02" />
              <span className="text-item font-bold text-fg-1">
                Build on top of
              </span>
              <span
                className={cn(
                  "px-1.5 py-0.5 font-mono text-pill font-semibold uppercase",
                  mode === "none"
                    ? "border border-critical/45 bg-critical-wash text-critical-ink"
                    : "border border-line text-fg-5",
                )}
              >
                {mode === "none" ? "Required" : "Optional"}
              </span>
            </div>

            <div className="mb-2.5 flex flex-col gap-1.5">
              {selection.sources.map((s) => (
                <div
                  key={`${s.kind}:${s.id}`}
                  className="border border-line-strong bg-surface-1 px-3 py-2.5 shadow-[inset_3px_0_0_var(--yellow-base)]"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="shrink-0 border border-yellow-line px-1.5 py-0.5 font-mono text-pill font-bold uppercase text-yellow-ink">
                      {KIND_ABBREV[s.kind]}
                    </span>
                    <span className="min-w-0 truncate text-item font-semibold text-fg-1">
                      {label(s.kind, s.id, s.label)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSource(s.id, s.kind)}
                      title="Remove"
                      className="ml-auto shrink-0 border-0 bg-transparent font-mono text-item text-fg-5 hover:text-critical-ink"
                    >
                      ×
                    </button>
                  </div>

                  {s.kind === "Reflection" && (
                    <LastNControl
                      value={s.lastN ?? DEFAULT_LAST_N}
                      onChange={(n) => setLastN(s.id, n)}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-1.5">
              {(["Projection", "Reflection"] as const).map((k) => (
                <Adder
                  key={k}
                  label={k}
                  tint="yellow"
                  onClick={() => openPicker("source", k)}
                />
              ))}
            </div>

            {picker?.slot === "source" && (
              <div className="mt-2.5">
                <ItemPicker
                  kindLabel={picker.kind}
                  tint={pickerTint}
                  options={pickerOptions}
                  onPick={pick}
                  onClose={closePicker}
                  emptyCopy={pickerEmptyCopy}
                />
              </div>
            )}

            <p className="mt-3 text-meta text-fg-5 text-pretty">
              {mode === "none"
                ? "With no fragments selected, these syntheses are the only context — at least one is required."
                : "Synthesized output, not fragments — so these can't be excluded, and they survive a change of fragment mode untouched."}
            </p>
          </section>
        ) : (
          <div className="flex items-start gap-2.5 border-b border-line px-5 py-4">
            <span className="pt-px text-fg-5">
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </span>
            <p className="text-meta text-fg-5 text-pretty">
              A Reflection is a leaf node — it can't consume other syntheses, so{" "}
              <span className="text-fg-4">Build on top of</span> doesn't exist
              here.
            </p>
          </div>
        )}

        {/* ------------------------------------------------- 03 Focus ------ */}
        <section className="p-5">
          <div className="mb-1.5 flex items-baseline gap-2.5">
            <StageNumber n={sourcesAllowed ? "03" : "02"} />
            <span className="text-item font-bold text-fg-1">Focus</span>
          </div>
          <p className="mb-3 text-meta text-fg-5 text-pretty">
            Changes how the context is framed, never what's in it. Individual
            things only — a colour names a population, not a subject.
          </p>

          <div className="flex flex-col gap-1.5">
            {focusRows.map((f) => (
              <FocusRow
                key={`${f.kind}:${f.id}`}
                row={f}
                onFix={() => applyFix(f)}
              />
            ))}
          </div>

          <div className="mt-2.5 flex gap-1.5">
            {(mode === "none"
              ? (["Projection", "Reflection"] as const)
              : sourcesAllowed
                ? (["Fragment", "Projection", "Reflection"] as const)
                : (["Fragment"] as const)
            ).map((k) => (
              <Adder
                key={k}
                label={k}
                tint="magenta"
                onClick={() => openPicker("focus", k)}
              />
            ))}
          </div>

          {picker?.slot === "focus" && (
            <div className="mt-2.5">
              <ItemPicker
                kindLabel={picker.kind}
                tint={pickerTint}
                options={pickerOptions}
                onPick={pick}
                onClose={closePicker}
                emptyCopy={pickerEmptyCopy}
                loading={picker.kind === "Fragment" && fragmentSearch.loading}
                remoteFiltered={picker.kind === "Fragment"}
                onQueryChange={
                  picker.kind === "Fragment" ? setFragmentQuery : undefined
                }
              />
            </div>
          )}
        </section>
      </div>

      <ResolutionReadout
        totalTokens={resolved.totalTokens}
        contributors={contributors}
        fragmentCount={fragmentCount}
        sourceCount={selection.sources.length}
        onAutoSegment={autoSegmentNotReady}
      />
    </>
  );

  if (flush) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        {body}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-[480px] shrink-0 flex-col border-r border-line",
        className,
      )}
    >
      {/* A panel header, not a page title — the host screen already owns the
          one `display` heading, and DESIGN.md names "Context" as an example of
          the Archivo panel-header label. */}
      <PaneHeader
        label="Context"
        status={
          <Mono className="text-crumb uppercase text-fg-4">
            {ENTITY_LABEL[entity]}
          </Mono>
        }
      />
      <div className="shrink-0 border-b border-line px-5 py-3">
        <p className="text-body-sm text-fg-3 text-pretty">
          A standing rule for which of your material counts. It re-resolves as
          new material arrives.
        </p>
      </div>
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

function StageNumber({ n }: { n: string }) {
  return (
    <span className="shrink-0 border border-line-strong px-1.5 py-0.5 font-mono text-crumb font-bold text-fg-4">
      {n}
    </span>
  );
}

const ADDER_TINT: Record<PickerTint, string> = {
  cyan: "hover:border-section hover:text-section-ink hover:bg-section-wash",
  yellow: "hover:border-section hover:text-section-ink hover:bg-section-wash",
  magenta: "hover:border-magenta hover:text-magenta-ink hover:bg-magenta-wash",
  section: "hover:border-section hover:text-section-ink hover:bg-section-wash",
};

function Adder({
  label,
  tint,
  onClick,
}: {
  label: string;
  tint: PickerTint;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 border border-line-strong bg-transparent px-1.5 py-2 text-btn-sm font-semibold uppercase text-fg-3",
        ADDER_TINT[tint],
      )}
    >
      + {label}
    </button>
  );
}

/**
 * How many of a source Reflection's windows to pull in. `N` is a request; the
 * model clamps it to the windows actually materialized, so the control reports
 * the *effective* count rather than echoing the request back.
 */
function LastNControl({
  value,
  onChange,
}: {
  value: LastN;
  onChange: (n: LastN) => void;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="text-label font-semibold uppercase text-fg-4">Last</span>
      <div className="flex border border-line-strong">
        {LAST_N_OPTIONS.map((n) => (
          <button
            key={String(n)}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={cn(
              "border-0 border-r border-line-strong px-2.5 py-1 font-mono text-mono-sm font-semibold last:border-r-0",
              value === n
                ? "bg-yellow text-yellow-foreground"
                : "bg-transparent text-fg-3 hover:text-fg-1",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {/* The materialized-window count is not reported by the API yet, so the
          effective count cannot be stated. Showing a clamped number we cannot
          verify would be worse than showing none. */}
      <span className="ml-auto font-mono text-mono-sm text-fg-5">
        {value === "all" ? "every window" : "most recent"}
      </span>
    </div>
  );
}

type FocusTone = "ok" | "added" | "blocked" | "invalid";

/** What a row's fix does, named rather than captured — see `applyFix`. */
type FixKind = "removeFocus" | "dropExclusion" | "switchToOnly";

interface FocusRowModel {
  kind: string;
  id: string;
  name: string;
  tone: FocusTone;
  state: string;
  reason?: string;
  fix?: string;
  fixKind?: FixKind;
}

const FOCUS_TONE: Record<
  FocusTone,
  { box: string; pill: string; state: string; strike?: boolean }
> = {
  ok: {
    box: "border-magenta-edge bg-magenta-veil shadow-[inset_3px_0_0_var(--magenta-base)]",
    pill: "border-magenta-edge text-magenta-ink",
    state: "text-fg-5",
  },
  added: {
    box: "border-section-edge bg-section-veil shadow-[inset_3px_0_0_var(--section)]",
    pill: "border-section-edge text-section-ink",
    state: "text-section-ink",
  },
  blocked: {
    box: "border-critical/45 bg-critical-wash shadow-[inset_3px_0_0_var(--status-critical)]",
    pill: "border-critical/45 text-critical-ink",
    state: "text-critical-ink",
    strike: true,
  },
  invalid: {
    box: "border-critical/45 bg-critical-wash shadow-[inset_3px_0_0_var(--status-critical)]",
    pill: "border-critical/45 text-critical-ink",
    state: "text-critical-ink",
  },
};

function FocusRow({ row, onFix }: { row: FocusRowModel; onFix?: () => void }) {
  const t = FOCUS_TONE[row.tone];
  return (
    <div className={cn("border px-3 py-2.5", t.box)}>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "shrink-0 border px-1.5 py-0.5 font-mono text-pill font-bold uppercase",
            t.pill,
          )}
        >
          {KIND_ABBREV[row.kind] ?? row.kind}
        </span>
        <span
          className={cn(
            "min-w-0 truncate text-item font-semibold",
            t.strike ? "text-fg-3 line-through" : "text-fg-1",
          )}
        >
          {row.name}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-pill font-semibold uppercase",
            t.state,
          )}
        >
          {row.state}
        </span>
      </div>

      {row.reason && (
        <div className="mt-2 flex items-baseline gap-2.5 border-t border-line pt-2">
          <span className="min-w-0 text-meta text-fg-3">{row.reason}</span>
          {row.fix && (
            <button
              type="button"
              onClick={onFix}
              className="ml-auto shrink-0 whitespace-nowrap border-0 border-b border-line-strong bg-transparent pb-px text-btn-sm font-semibold uppercase text-fg-4 hover:text-fg-1"
            >
              {row.fix}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Auto-segmentation is a separate flow, not yet built. */
function autoSegmentNotReady() {
  console.warn("Auto-segment: flow not implemented yet.");
}

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
