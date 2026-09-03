import { ClockIcon, FileTextIcon, XIcon } from "lucide-react";
import { DocumentCard, Label, StatusPill } from "@/components/kalaido";
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
      {discovering ? (
        <p className="text-meta text-fg-4">
          Looking for patterns in your notes…
        </p>
      ) : error ? (
        <p className="text-meta text-fg-4">
          Couldn't finish looking for patterns: {error}
        </p>
      ) : null}
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
              footer={
                <span className="text-meta text-fg-4">
                  {it.fragments} fragments
                </span>
              }
            >
              <p className="line-clamp-3 text-meta text-fg-3">{it.message}</p>
            </DocumentCard>
          );
        })}
      </div>
    </section>
  );
}
