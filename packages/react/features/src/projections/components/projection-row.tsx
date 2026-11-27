import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import type { ProjectionResponse } from "@kalaido/client/kalaidoscope/types";
import { SourceList } from "@kalaido/components";
import { Mono, PinToggle } from "@kalaido/primitives/kalaido";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { SourceItem } from "../sources";
import type { ProjectionStatusInfo } from "../status";

/** Shared by the header and every row so the columns line up. */
const COLUMNS =
  "grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_2.5rem] items-center gap-4 px-4";

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
  /** True whenever an interactive draft session or pending draft is open. */
  hasDraftInProgress: boolean;
  updating?: boolean;
  sources: SourceItem[];
  onOpen: (id: string) => void;
  onUpdate: (p: ProjectionResponse) => void;
  onTogglePin: (p: ProjectionResponse) => void;
}

/** One projection in the list: name, temporal/draft status with direct update,
 *  and what sources it reads from. */
export function ProjectionRow({
  p,
  generatedAt,
  status,
  hasDraftInProgress,
  updating = false,
  sources,
  onOpen,
  onUpdate,
  onTogglePin,
}: ProjectionRowProps) {
  const pinned = Boolean(p.pinned);
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
      </button>
      <GeneratedCell
        status={status}
        generatedAt={generatedAt}
        hasDraftInProgress={hasDraftInProgress}
        updating={updating}
        onUpdate={() => onUpdate(p)}
      />
      <span className="min-w-0 overflow-hidden">
        <SourceList sources={sources} className="flex-nowrap" />
      </span>
      <span className="relative z-10 pointer-events-none flex items-center justify-end gap-1 [&_button]:pointer-events-auto">
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
  hasDraftInProgress,
  updating,
  onUpdate,
}: {
  status: ProjectionStatusInfo;
  generatedAt?: string;
  hasDraftInProgress: boolean;
  updating: boolean;
  onUpdate: () => void;
}) {
  if (status.status === "generating")
    return <Mono className="truncate text-mono-sm text-fg-3">updating…</Mono>;
  if (status.status === "preparing")
    return (
      <Mono className="truncate text-mono-sm text-fg-3">preparing lens…</Mono>
    );
  return (
    <span className="relative z-10 pointer-events-none flex min-w-0 items-center gap-1.5 [&_button]:pointer-events-auto">
      <Mono className="min-w-0 truncate text-mono-sm text-fg-3">
        {generatedAt ? formatShortDateTime(generatedAt) : "not generated yet"}
        {hasDraftInProgress && (
          <span className="text-section-ink"> · draft in progress</span>
        )}
        {status.entropy > 0 && (
          <span className="text-fg-4"> · {status.entropy} new since</span>
        )}
      </Mono>
      {generatedAt && (
        <RowAction
          label="Update projection"
          disabled={updating}
          onClick={onUpdate}
        >
          <ArrowsClockwiseIcon
            className={cn("size-3.5", updating && "animate-spin")}
          />
        </RowAction>
      )}
    </span>
  );
}

/** An icon action inside the row. */
function RowAction({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-none text-section-ink outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
