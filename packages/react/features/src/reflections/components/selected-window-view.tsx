import { REFLECTION_EMPTY_WINDOW_OUTPUT } from "@kalaido/client/kalaidoscope/reflections";
import { MarkdownContent } from "@kalaido/components";
import {
  DocBody,
  EmptyState,
  Mono,
  Pill,
  StatusPill,
} from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@kalaido/primitives/shadcn/native-select";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { SeriesWindow } from "../hooks/use-reflection-series";
import {
  deriveViewedRevision,
  revisionOptionLabel,
  type ViewedRevisionState,
  windowActionLabel,
  windowLabel,
} from "../window-display";

export interface SelectedWindowViewProps {
  error: Error | null | undefined;
  loading: boolean;
  selected: SeriesWindow | undefined;
  busy: string | null;
  onRegenerate: (w: SeriesWindow) => void;
  onEdit: (w: SeriesWindow, initialOutput: string) => void;
}

function WindowHeaderBar({
  selected,
  rev,
  busy,
  onSelectRevision,
  onRegenerate,
  onEdit,
}: {
  selected: SeriesWindow;
  rev: ViewedRevisionState;
  busy: string | null;
  onSelectRevision: (id: string) => void;
  onRegenerate: (w: SeriesWindow) => void;
  onEdit: (w: SeriesWindow, initialOutput: string) => void;
}) {
  const actionsDisabled = busy !== null || selected.generating;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      <span className="text-item font-semibold">{windowLabel(selected)}</span>
      {selected.generating && <StatusPill kind="cyan">generating</StatusPill>}
      {rev.showOlderLens && <StatusPill kind="yellow">Older lens</StatusPill>}
      {rev.showNewFragments && (
        <StatusPill kind="magenta">New fragments</StatusPill>
      )}
      {rev.isManual && <Pill>Edited</Pill>}
      {rev.isEmpty && <Pill>Empty window</Pill>}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {selected.revisions.length > 1 && rev.viewed && (
          <NativeSelect
            size="sm"
            className="max-w-[190px]"
            aria-label="Window revision"
            value={rev.viewed.id}
            onChange={(e) => onSelectRevision(e.target.value)}
          >
            {selected.revisions.map((item, idx) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {revisionOptionLabel(item, idx, selected.revisions.length)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {rev.viewed && (
          <Button
            size="sm"
            variant="outline"
            disabled={actionsDisabled}
            onClick={() => onEdit(selected, rev.content ?? "")}
          >
            <PencilSimpleIcon />
            Edit
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={actionsDisabled}
          onClick={() => onRegenerate(selected)}
        >
          {windowActionLabel(busy, selected)}
        </Button>
      </div>
    </div>
  );
}

function WindowRevisionBody({
  generating,
  rev,
}: {
  generating: boolean;
  rev: ViewedRevisionState;
}) {
  if (!rev.viewed) {
    return (
      <EmptyState>
        {generating
          ? "Generating this window’s summary…"
          : "No summary for this window yet."}
      </EmptyState>
    );
  }
  if (rev.isEmpty) {
    return (
      <EmptyState className="max-w-[540px] border border-line bg-surface-1 p-5">
        <p className="text-body-sm font-medium text-fg-2">
          {rev.content || REFLECTION_EMPTY_WINDOW_OUTPUT}
        </p>
        <p className="mt-1 text-meta text-fg-4">
          No matching fragments occurred during this window. If fragments are
          added later, this window will upgrade automatically.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="max-w-[540px]">
      <div className="text-body leading-relaxed text-fg-1">
        {rev.content ? (
          <MarkdownContent content={rev.content} />
        ) : (
          "(empty snapshot)"
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Mono className="text-meta text-fg-4">
          {rev.originLabel}
          {rev.displayModel ? ` · ${rev.displayModel}` : ""}
        </Mono>
      </div>
    </div>
  );
}

export function SelectedWindowView({
  error,
  loading,
  selected,
  busy,
  onRegenerate,
  onEdit,
}: SelectedWindowViewProps) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null,
  );

  if (error) {
    return (
      <p className="text-body-sm text-destructive">
        Couldn’t load this reflection: {error.message}
      </p>
    );
  }
  if (loading && !selected) {
    return (
      <div className="max-w-[500px]">
        <DocBody paragraphs={3} />
      </div>
    );
  }
  if (!selected) {
    return (
      <EmptyState>
        No windows yet — the first summary appears once the lens is committed
        and a window completes.
      </EmptyState>
    );
  }

  const rev = deriveViewedRevision(selected, selectedRevisionId);

  return (
    <>
      <WindowHeaderBar
        selected={selected}
        rev={rev}
        busy={busy}
        onSelectRevision={setSelectedRevisionId}
        onRegenerate={onRegenerate}
        onEdit={onEdit}
      />

      {!rev.isLatest && rev.viewed && (
        <div className="mb-4 flex items-center justify-between gap-2 border border-line bg-surface-1 px-3 py-2 text-meta text-fg-3">
          <span>Viewing an earlier revision ({rev.originLabel}).</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setSelectedRevisionId(null)}
          >
            Back to latest
          </Button>
        </div>
      )}

      <WindowRevisionBody generating={selected.generating} rev={rev} />
    </>
  );
}
