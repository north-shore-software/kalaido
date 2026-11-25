import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { ProjectionResponse } from "@kalaido/client/kalaidoscope/types";
import { SourceList } from "@kalaido/components";
import { Mono, Pill, PinToggle } from "@kalaido/primitives/kalaido";
import type { SourceItem } from "../sources";
import type { ProjectionStatusInfo } from "../status";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";

/** Shared by the header and every row so the columns line up. */
const COLUMNS =
  "grid grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_4rem] items-center gap-4 px-4";

export function ProjectionTableHeader() {
  return (
    <div className={cn(COLUMNS, "border-b border-line py-2")}>
      <HeaderCell>Name</HeaderCell>
      <HeaderCell>Last generated</HeaderCell>
      <HeaderCell>Sources</HeaderCell>
      <span />
    </div>
  );
}

function HeaderCell({ children }: { children: ReactNode }) {
  return (
    <Mono className="truncate text-label font-semibold uppercase text-fg-4">
      {children}
    </Mono>
  );
}

export interface ProjectionRowProps {
  p: ProjectionResponse;
  /** When the live output was generated; absent if it never has been. */
  generatedAt?: string;
  status: ProjectionStatusInfo;
  /** Set while a pending candidate exists; the row offers to open it. */
  candidateId?: string;
  sources: SourceItem[];
  onOpen: (id: string) => void;
  onReview: (id: string, candidateId: string) => void;
  onTogglePin: (p: ProjectionResponse) => void;
}

/** One projection in the list: name, how old its output is, what it reads
 *  from. Age is information only — nothing here asks to be refreshed. */
export function ProjectionRow({
  p,
  generatedAt,
  status,
  candidateId,
  sources,
  onOpen,
  onReview,
  onTogglePin,
}: ProjectionRowProps) {
  const pinned = Boolean(p.pinned);
  const hasCandidate = Boolean(candidateId) && status.status === "pending";
  return (
    <div
      title={p.description || undefined}
      className={cn(
        COLUMNS,
        "group relative w-full border-b border-line py-3 text-left transition-colors hover:bg-surface-2/50 has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50",
      )}
    >
      <button
        type="button"
        data-row-primary
        onClick={() => onOpen(p.id)}
        className="flex min-w-0 cursor-pointer items-center gap-3 text-left outline-none after:absolute after:inset-0 after:content-['']"
      >
        <span className="size-[13px] shrink-0 rounded-none bg-section" />
        <span className="truncate text-row font-medium text-fg-1">
          {p.name || "Untitled projection"}
        </span>
        {hasCandidate && <Pill>candidate</Pill>}
      </button>
      <GeneratedCell status={status} generatedAt={generatedAt} />
      <span className="min-w-0 overflow-hidden">
        <SourceList sources={sources} className="flex-nowrap" />
      </span>
      <span className="relative z-10 pointer-events-none flex items-center justify-end gap-1 [&_button]:pointer-events-auto">
        {hasCandidate && candidateId && (
          <RowAction
            label="Review candidate"
            onClick={() => onReview(p.id, candidateId)}
          >
            <ArrowsClockwiseIcon className="size-3.5" />
          </RowAction>
        )}
        <span
          className={cn(
            "transition-opacity",
            !pinned &&
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <PinToggle pinned={pinned} onToggle={() => onTogglePin(p)} />
        </span>
      </span>
    </div>
  );
}

function GeneratedCell({
  status,
  generatedAt,
}: {
  status: ProjectionStatusInfo;
  generatedAt?: string;
}) {
  if (status.status === "generating")
    return <Mono className="truncate text-mono-sm text-fg-3">generating…</Mono>;
  if (status.status === "preparing")
    return (
      <Mono className="truncate text-mono-sm text-fg-3">preparing lens…</Mono>
    );
  return (
    <Mono className="truncate text-mono-sm text-fg-3">
      {generatedAt ? formatShortDateTime(generatedAt) : "not generated yet"}
      {status.entropy > 0 && (
        <span className="text-fg-4"> · {status.entropy} new since</span>
      )}
    </Mono>
  );
}

/** An icon action inside the row. */
function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-none text-section-ink outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
