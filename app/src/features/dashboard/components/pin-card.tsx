import { ClockIcon, FileTextIcon, PinOffIcon } from "lucide-react";
import { DocumentCard, StatusPill } from "@/components/kalaido";
import type { EntityKind, PinItem } from "../types";

export interface PinCardProps {
  item: PinItem;
  onOpen: (item: PinItem) => void;
  onUnpin: (item: PinItem) => void;
}

function PinIcon({ kind }: { kind: EntityKind }) {
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

export function PinCard({ item, onOpen, onUnpin }: PinCardProps) {
  const isProj = item.kind === "projection";
  return (
    <DocumentCard
      className="w-[calc(50%-7px)]"
      onClick={() => onOpen(item)}
      leading={
        <>
          <PinIcon kind={item.kind} />
          <span
            className={
              isProj
                ? "size-[11px] bg-green rounded-none shrink-0"
                : "size-[11px] bg-violet rounded-none shrink-0"
            }
          />
        </>
      }
      title={item.name}
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
            aria-label="Unpin"
            className="flex size-6 items-center justify-center rounded-none text-fg-4 transition-colors hover:bg-surface-2 hover:text-fg-2"
            onClick={(e) => {
              e.stopPropagation();
              onUnpin(item);
            }}
          >
            <PinOffIcon className="size-3.5" />
          </button>
        </>
      }
      lines={["100%", "92%", "60%"]}
      contentClassName="h-[74px]"
    />
  );
}
