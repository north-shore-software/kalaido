import type { RefinePhase } from "@kalaido/client/kalaidoscope/refinements";
import {
  type PreviewReflectionWindow,
  REFLECTION_EMPTY_WINDOW_OUTPUT,
} from "@kalaido/client/kalaidoscope/reflections";
import { formatWindowRange } from "@kalaido/client/lib/datetime";
import { MarkdownContent } from "@kalaido/components";
import { useAutoScroll } from "@kalaido/hooks/use-auto-scroll";
import { EmptyState, Mono, Pill } from "@kalaido/primitives/kalaido";
import { PaneHeader } from "@kalaido/primitives/layout/page-primitives";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@kalaido/primitives/shadcn/native-select";
import { PlayIcon } from "@phosphor-icons/react";

export interface LivePreviewPaneProps {
  preview: string;
  phase?: RefinePhase;
  previewWindows: readonly PreviewReflectionWindow[];
  activeWindow: PreviewReflectionWindow | undefined;
  onSelectWindow: (win: PreviewReflectionWindow) => void;
  previewStale: boolean;
  previewLoading: boolean;
  windowsLoading?: boolean;
  canPreview: boolean;
  onRunPreview: () => void;
  className?: string;
}

function formatFragmentCount(count: number): string {
  return `${count} ${count === 1 ? "fragment" : "fragments"}`;
}

function previewStatusLabel(
  phase: RefinePhase,
  previewLoading: boolean,
  hasPreview: boolean,
  stale: boolean,
): string {
  if (phase === "drafting") return "drafting";
  if (phase === "applying" || previewLoading) return "generating";
  if (hasPreview && stale) return "out of sync";
  return hasPreview ? "preview" : "pending";
}

function emptyPreviewCopy(
  phase: RefinePhase,
  previewLoading: boolean,
  canPreview: boolean,
): string {
  if (phase === "drafting") return "Drafting the standing lens…";
  if (phase === "applying" || previewLoading) return "Generating the preview…";
  if (canPreview) {
    return "Click Preview above to run your standing lens against the selected sample window.";
  }
  return "Describe your reflection in Lens chat or write a standing lens directly to preview a sample window.";
}

function PreviewHeaderControls({
  previewWindows,
  activeWindow,
  onSelectWindow,
  previewStale,
  previewLoading,
  isGenerating,
  canPreview,
  statusLabel,
  onRunPreview,
}: {
  previewWindows: readonly PreviewReflectionWindow[];
  activeWindow: PreviewReflectionWindow | undefined;
  onSelectWindow: (win: PreviewReflectionWindow) => void;
  previewStale: boolean;
  previewLoading: boolean;
  isGenerating: boolean;
  canPreview: boolean;
  statusLabel: string;
  onRunPreview: () => void;
}) {
  const reversed = [...previewWindows].reverse();
  const disabled = !canPreview || !activeWindow || isGenerating;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {reversed.length > 0 && (
        <NativeSelect
          size="sm"
          className="max-w-[260px]"
          aria-label="Sample window"
          value={activeWindow?.key ?? ""}
          disabled={isGenerating}
          onChange={(e) => {
            const picked = previewWindows.find((w) => w.key === e.target.value);
            if (picked) onSelectWindow(picked);
          }}
        >
          {reversed.map((w) => (
            <NativeSelectOption key={w.key} value={w.key}>
              {`${formatWindowRange(w.start, w.end)} · ${formatFragmentCount(w.fragmentCount)}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      <Button
        size="xs"
        variant={previewStale && canPreview ? "section" : "outline"}
        disabled={disabled}
        onClick={onRunPreview}
      >
        <PlayIcon />
        {previewLoading ? "Previewing…" : "Preview"}
      </Button>
      <Pill tone="primary" dot>
        {statusLabel}
      </Pill>
    </div>
  );
}

function PreviewBodyContent({
  preview,
  phase,
  previewLoading,
  canPreview,
}: {
  preview: string;
  phase: RefinePhase;
  previewLoading: boolean;
  canPreview: boolean;
}) {
  const trimmed = preview.trim();
  if (!trimmed) {
    return (
      <p className="text-body-sm text-fg-3">
        {emptyPreviewCopy(phase, previewLoading, canPreview)}
      </p>
    );
  }
  if (trimmed === REFLECTION_EMPTY_WINDOW_OUTPUT) {
    return (
      <EmptyState className="border border-line bg-surface-1 p-5">
        <p className="text-body-sm font-medium text-fg-2">
          {REFLECTION_EMPTY_WINDOW_OUTPUT}
        </p>
        <p className="mt-1 text-meta text-fg-4">
          No matching fragments fell inside this sample window — switch windows
          above or adjust Schedule &amp; Sources to test another period.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="text-body leading-relaxed text-fg-1">
      <MarkdownContent streaming content={preview} />
    </div>
  );
}

export function LivePreviewPane({
  preview,
  phase = "idle",
  previewWindows,
  activeWindow,
  onSelectWindow,
  previewStale,
  previewLoading,
  windowsLoading = false,
  canPreview,
  onRunPreview,
  className,
}: LivePreviewPaneProps) {
  const isGenerating =
    phase === "drafting" || phase === "applying" || previewLoading;
  const { containerRef, onScroll } = useAutoScroll({
    active: phase === "applying",
    content: preview,
  });

  const hasPreview = preview.trim().length > 0;
  const statusLabel = previewStatusLabel(
    phase,
    previewLoading,
    hasPreview,
    previewStale,
  );
  const showStaleBanner = previewStale && hasPreview && !isGenerating;

  return (
    <div className={cn("flex min-w-0 flex-[1.05] flex-col", className)}>
      <PaneHeader
        label="Preview"
        status={
          <PreviewHeaderControls
            previewWindows={previewWindows}
            activeWindow={activeWindow}
            onSelectWindow={onSelectWindow}
            previewStale={previewStale}
            previewLoading={previewLoading}
            isGenerating={isGenerating}
            canPreview={canPreview}
            statusLabel={statusLabel}
            onRunPreview={onRunPreview}
          />
        }
      />

      {activeWindow && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-1 px-5 py-2">
          <Mono className="text-mono-sm text-fg-3">
            {formatWindowRange(activeWindow.start, activeWindow.end)}
          </Mono>
          <Mono className="text-mono-sm text-fg-4">
            {windowsLoading
              ? "Counting fragments…"
              : `${formatFragmentCount(activeWindow.fragmentCount)} matching`}
          </Mono>
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto p-5"
      >
        {showStaleBanner && (
          <div className="mb-4 flex items-center justify-between gap-3 border border-line-strong bg-surface-1 px-3.5 py-2.5 text-meta text-fg-2">
            <span>Settings changed — click Preview to update.</span>
            <Button
              size="xs"
              variant="outline"
              disabled={!canPreview || !activeWindow}
              onClick={onRunPreview}
            >
              Preview
            </Button>
          </div>
        )}

        <PreviewBodyContent
          preview={preview}
          phase={phase}
          previewLoading={previewLoading}
          canPreview={canPreview}
        />
      </div>
    </div>
  );
}
