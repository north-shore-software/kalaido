import { ClockIcon, FileTextIcon, PinOffIcon } from "lucide-react";
import { ColourSwatch, DocumentCard, StatusPill } from "@/components/kalaido";
import { swatchIndex } from "@/lib/colors";
import type { EntityKind, PinItem } from "../types";

export interface PinCardProps {
  item: PinItem;
  onOpen: (item: PinItem) => void;
  onUnpin: (item: PinItem) => void;
}

function PinIcon({ kind }: { kind: EntityKind }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2">
      {kind === "projection" ? (
        <FileTextIcon className="size-3.5 text-truth-ink" />
      ) : (
        <ClockIcon className="size-3.5 text-fg-3" />
      )}
    </span>
  );
}

export function PinCard({ item, onOpen, onUnpin }: PinCardProps) {
  return (
    <DocumentCard
      className="w-[calc(50%-7px)]"
      onClick={() => onOpen(item)}
      leading={
        <>
          <PinIcon kind={item.kind} />
          <ColourSwatch c={swatchIndex(item.id)} size={11} />
        </>
      }
      title={item.name}
      trailing={
        <>
          <StatusPill kind="neutral">
            {item.kind === "projection" ? "PROJ" : "REFL"}
          </StatusPill>
          <button
            type="button"
            aria-label="Unpin"
            className="flex size-6 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-surface-2 hover:text-fg-2"
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
