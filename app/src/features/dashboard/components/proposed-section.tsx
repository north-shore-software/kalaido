import { ClockIcon, FileTextIcon, XIcon } from "lucide-react";
import {
  DocumentCard,
  Label,
  SourceList,
  StatusPill,
} from "@/components/kalaido";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { EntityKind, ProposedItem } from "../types";

export interface ProposedSectionProps {
  items: ProposedItem[];
  discovering?: boolean;
  error?: string;
  onOpen: (item: ProposedItem) => void;
  onDismiss: (item: ProposedItem) => void;
}

function KindIcon({ kind }: { kind: EntityKind }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-none bg-surface-2">
      {kind === "projection" ? (
        <FileTextIcon className="size-3.5 text-green" />
      ) : (
        <ClockIcon className="size-3.5 text-violet" />
      )}
    </span>
  );
}

function ProposedLoadingCard() {
  return (
    <DocumentCard
      className="w-[calc(50%-7px)]"
      leading={
        <span className="flex size-7 shrink-0 items-center justify-center rounded-none bg-surface-2">
          <Spinner className="size-3.5 text-fg-3" />
        </span>
      }
      title="Looking for patterns in your notes…"
      trailing={<StatusPill>DISCOVERING</StatusPill>}
      contentClassName="flex h-[74px] flex-col justify-center gap-2"
      footer={
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-16 rounded-none" />
          <Skeleton className="h-4 w-20 rounded-none" />
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-2 w-full rounded-none" />
        <Skeleton className="h-2 w-[85%] rounded-none" />
        <Skeleton className="h-2 w-[60%] rounded-none" />
      </div>
    </DocumentCard>
  );
}

/**
 * What a discover run proposed and nobody has taken up yet. Opening a card
 * starts the ordinary authoring chat over the proposed row, with its scope
 * pinned and its opening message sent as the first turn; the row becomes
 * active when that refinement is committed. A reflection proposal also
 * carries its schedule, so committing it backfills the series from the date
 * the rhythm began.
 */
export function ProposedSection({
  items,
  discovering,
  error,
  onOpen,
  onDismiss,
}: ProposedSectionProps) {
  if (items.length === 0 && !discovering && !error) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Label>Proposed</Label>
        <div className="flex-1" />
      </div>
      {error && (
        <p className="text-meta text-fg-4">
          Couldn't finish looking for patterns: {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3.5">
        {items.map((it) => {
          const isProj = it.kind === "projection";
          return (
            <DocumentCard
              key={`${it.kind}:${it.id}`}
              className="w-[calc(50%-7px)]"
              onClick={() => onOpen(it)}
              leading={<KindIcon kind={it.kind} />}
              title={it.name}
              trailing={
                <>
                  <StatusPill
                    className={
                      isProj
                        ? "border-green/45 bg-green/10 text-green"
                        : "border-violet/45 bg-violet/10 text-violet"
                    }
                  >
                    {isProj ? "PROJ" : "REFL"}
                  </StatusPill>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    className="flex size-6 items-center justify-center rounded-none text-fg-4 transition-colors hover:bg-surface-2 hover:text-fg-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(it);
                    }}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </>
              }
              contentClassName="h-[74px]"
              footer={<SourceList sources={it.sources} />}
            >
              <p className="line-clamp-3 text-meta text-fg-3">{it.message}</p>
            </DocumentCard>
          );
        })}
        {discovering && <ProposedLoadingCard />}
      </div>
    </section>
  );
}
